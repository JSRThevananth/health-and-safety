import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { canAccessUnit } from '../services/permissions.js'
import {
  PRIORITIES,
  capaEvents,
  capaSummary,
  closeCapa,
  defaultDueDate,
  getCapa,
  listCapas,
  priorityForRating,
  raiseCapa,
  reopenCapa,
  updateCapa,
} from '../services/capas.js'

const capas = new Hono()

/** Load an action the caller is allowed to see, or 404 as if it did not exist. */
async function scoped(c) {
  const capa = await getCapa(c.get('db'), Number(c.req.param('id')))
  if (!capa || !canAccessUnit(c.get('user'), capa.unit_id)) throw fail(404, 'Action not found')
  return capa
}

const listQuery = z.object({
  unit_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  // "mine" is the view an owner actually wants: everything assigned to me,
  // across every unit I work in. Spelled out rather than z.coerce.boolean(),
  // which reads the string "false" as true.
  mine: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((value) => value === '1' || value === 'true'),
})

capas.get('/', requirePermission('unit.view'), validateQuery(listQuery), async (c) => {
  const user = c.get('user')
  const query = c.get('query')

  if (query.unit_id && !canAccessUnit(user, query.unit_id)) throw fail(404, 'Unit not found')

  return c.json(
    await listCapas(c.get('db'), {
      unitIds: user.unitIds,
      unitId: query.unit_id ?? null,
      status: query.status ?? null,
      ownerId: query.mine ? user.id : null,
    })
  )
})

/** Counts for the dashboard: open, overdue, due this week, high priority. */
capas.get('/summary', requirePermission('unit.view'), async (c) =>
  c.json(await capaSummary(c.get('db'), c.get('user').unitIds))
)

const raiseSchema = z.object({
  unit_id: z.coerce.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  detail: z.string().max(4000).default(''),
  priority: z.enum(PRIORITIES).optional(),
  owner_id: z.coerce.number().int().positive().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-24').optional(),
  // Where it came from, when it is raised off a finding.
  inspection_id: z.coerce.number().int().positive().optional(),
  template_item_id: z.coerce.number().int().positive().optional(),
})

capas.post('/', requirePermission('capa.create'), validateBody(raiseSchema), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = c.get('body')

  if (!canAccessUnit(user, body.unit_id)) throw fail(404, 'Unit not found')

  // An inspection named here has to belong to the same unit, or an action could
  // be hung off another unit's record.
  if (body.inspection_id) {
    const inspection = await db.get('SELECT unit_id FROM inspections WHERE id = @id', { id: body.inspection_id })
    if (!inspection || inspection.unit_id !== body.unit_id) {
      throw fail(422, 'That inspection does not belong to this unit')
    }
  }
  if (body.owner_id && !(await sameTenant(db, user, body.owner_id))) {
    throw fail(422, 'That owner is not someone you can assign')
  }

  const priority = body.priority || 'normal'
  const capa = await raiseCapa(db, {
    unitId: body.unit_id,
    actorId: user.id,
    title: body.title,
    detail: body.detail,
    priority,
    ownerId: body.owner_id ?? null,
    dueDate: body.due_date ?? defaultDueDate(priority),
    inspectionId: body.inspection_id ?? null,
    templateItemId: body.template_item_id ?? null,
  })
  return c.json(capa, 201)
})

/**
 * Raise actions for a submitted inspection's findings, in one go.
 *
 * The moment people will actually do this is at sign-off, looking at the list
 * of what was wrong. Asking them to retype each finding into a separate form is
 * how a corrective action log ends up empty.
 */
const fromInspectionSchema = z.object({
  template_item_ids: z.array(z.coerce.number().int().positive()).min(1).max(50),
  owner_id: z.coerce.number().int().positive().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

capas.post('/from-inspection/:id', requirePermission('capa.create'), validateBody(fromInspectionSchema), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = c.get('body')

  const inspection = await db.get('SELECT * FROM inspections WHERE id = @id', { id: c.req.param('id') })
  if (!inspection || !canAccessUnit(user, inspection.unit_id)) throw fail(404, 'Inspection not found')
  if (body.owner_id && !(await sameTenant(db, user, body.owner_id))) {
    throw fail(422, 'That owner is not someone you can assign')
  }

  // The findings named, with their wording and rating as recorded.
  const findings = await db.all(
    `SELECT it.template_item_id, it.rating, it.note,
            COALESCE(ti.text_override, li.text, ci.text) AS text
       FROM inspection_items it
       JOIN unit_template_items ti ON ti.id = it.template_item_id
       LEFT JOIN library_items li ON li.id = ti.library_item_id
       LEFT JOIN unit_custom_items ci ON ci.id = ti.custom_item_id
      WHERE it.inspection_id = @id
        AND it.template_item_id IN (${db.idList(body.template_item_ids)})`,
    { id: inspection.id }
  )

  if (findings.length === 0) throw fail(422, 'None of those findings belong to this inspection')

  // An action already raised for this finding on this inspection is not raised
  // twice: pressing the button again after adding one more should not duplicate
  // everything that came before it.
  const existing = new Set(
    await db.pluck(
      `SELECT template_item_id FROM capas
        WHERE inspection_id = @id AND template_item_id IS NOT NULL`,
      { id: inspection.id }
    )
  )

  const created = []
  for (const finding of findings) {
    if (existing.has(finding.template_item_id)) continue
    const priority = priorityForRating(finding.rating)
    created.push(
      await raiseCapa(db, {
        unitId: inspection.unit_id,
        actorId: user.id,
        title: finding.text || 'Finding',
        detail: finding.note || '',
        priority,
        ownerId: body.owner_id ?? null,
        dueDate: body.due_date ?? defaultDueDate(priority),
        inspectionId: inspection.id,
        templateItemId: finding.template_item_id,
      })
    )
  }

  return c.json({ created: created.length, skipped: findings.length - created.length, capas: created }, 201)
})

capas.get('/:id', requirePermission('unit.view'), async (c) => {
  const capa = await scoped(c)
  return c.json({ ...capa, events: await capaEvents(c.get('db'), capa.id) })
})

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  detail: z.string().max(4000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner_id: z.coerce.number().int().positive().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-24').nullable().optional(),
})

capas.patch('/:id', requirePermission('capa.assign'), validateBody(updateSchema), async (c) => {
  const db = c.get('db')
  const capa = await scoped(c)
  const body = c.get('body')

  // A closed action is the record of what was done. Reopen it first.
  if (capa.status !== 'open') throw fail(409, 'This action is closed. Reopen it before changing it.')
  if (body.owner_id && !(await sameTenant(db, c.get('user'), body.owner_id))) {
    throw fail(422, 'That owner is not someone you can assign')
  }

  const { capa: updated } = await updateCapa(db, capa, c.get('user').id, body)
  return c.json(updated)
})

const closeSchema = z.object({
  // Required, and that is the point: "done" with nothing behind it is exactly
  // what this table exists to prevent.
  note: z.string().trim().min(3).max(2000),
  status: z.enum(['done', 'cancelled']).default('done'),
})

capas.post('/:id/close', requirePermission('capa.close'), validateBody(closeSchema), async (c) => {
  const capa = await scoped(c)
  if (capa.status !== 'open') throw fail(409, 'This action is already closed')
  return c.json(await closeCapa(c.get('db'), capa, c.get('user').id, c.get('body')))
})

const reopenSchema = z.object({ reason: z.string().trim().min(3).max(2000) })

capas.post('/:id/reopen', requirePermission('capa.close'), validateBody(reopenSchema), async (c) => {
  const capa = await scoped(c)
  if (capa.status === 'open') throw fail(409, 'This action is already open')
  return c.json(await reopenCapa(c.get('db'), capa, c.get('user').id, c.get('body').reason))
})

/** Can this caller hand work to this person: same tenant, and still active. */
async function sameTenant(db, user, userId) {
  const row = await db.get('SELECT tenant_id, active FROM users WHERE id = @id', { id: userId })
  return Boolean(row) && row.tenant_id === user.tenantId && row.active === 1
}

export default capas
