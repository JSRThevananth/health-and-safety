import { Hono } from 'hono'
import { z } from 'zod'
import { now } from '../db.js'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { canAccessUnit } from '../services/permissions.js'
import {
  RATINGS,
  openDraft,
  resolveInspection,
  applyItems,
  isEditable,
  isException,
} from '../services/inspections.js'
import {
  SIGNATURE_ROLES,
  validateSignatureImage,
  putSignature,
  hasSignature,
} from '../services/signatures.js'

const inspections = new Hono()

/** Load an inspection and confirm the caller's unit scope covers it. */
async function loadScoped(c) {
  const inspection = await c.get('db').get('SELECT * FROM inspections WHERE id = @id', {
    id: c.req.param('id'),
  })
  // Same response whether it is missing or out of scope, so a limited user cannot
  // probe for the existence of other units' inspections.
  if (!inspection || !canAccessUnit(c.get('user'), inspection.unit_id)) {
    throw fail(404, 'Inspection not found')
  }
  return inspection
}

/** Only the inspector who opened a draft may change it, and only while it is open. */
function assertOwnEditable(c, inspection, lockedMessage) {
  if (inspection.inspector_id !== c.get('user').id) {
    throw fail(403, 'This inspection belongs to another inspector')
  }
  if (!isEditable(inspection)) throw fail(409, lockedMessage, { code: 'INSPECTION_LOCKED' })
}

const unitQuery = z.object({ unit_id: z.coerce.number().int().positive() })

/** Resume: the caller's open draft for a unit, if there is one. */
inspections.get(
  '/draft',
  requirePermission('inspection.create'),
  validateQuery(unitQuery),
  async (c) => {
    const unitId = c.get('query').unit_id
    if (!canAccessUnit(c.get('user'), unitId)) throw fail(403, 'No access to this unit')

    const draft = await c.get('db').get(
      `SELECT id FROM inspections WHERE unit_id = @u AND inspector_id = @i AND status = 'draft'`,
      { u: unitId, i: c.get('user').id }
    )
    if (!draft) throw fail(404, 'No inspection in progress')
    return c.json(await resolveInspection(c.get('db'), draft.id))
  }
)

/** Start, or pick up where they left off. */
inspections.post('/draft', requirePermission('inspection.create'), validateBody(unitQuery), async (c) => {
  const unitId = c.get('body').unit_id
  if (!canAccessUnit(c.get('user'), unitId)) throw fail(403, 'No access to this unit')

  const result = await openDraft(c.get('db'), unitId, c.get('user').id)
  if (result.error) throw fail(result.status, result.error)
  return c.json(await resolveInspection(c.get('db'), result.inspection.id), result.created ? 201 : 200)
})

const saveSchema = z.object({
  department: z.string().max(120).optional(),
  shift: z.string().max(60).optional(),
  summary: z.string().max(4000).optional(),
  items: z
    .array(
      z.object({
        template_item_id: z.coerce.number().int().positive(),
        rating: z.enum(RATINGS),
        note: z.string().max(2000).default(''),
      })
    )
    .max(400)
    .default([]),
})

/** Autosave. Called as the inspector works, so nothing is lost to a locked phone. */
inspections.patch('/:id', requirePermission('inspection.create'), validateBody(saveSchema), async (c) => {
  const db = c.get('db')
  const body = c.get('body')
  const inspection = await loadScoped(c)
  assertOwnEditable(c, inspection, 'This inspection has been submitted and can no longer be changed')

  if (body.items.length > 0) {
    const result = await applyItems(db, inspection.id, body.items)
    if (result.error) throw fail(result.status, result.error)
  }

  const meta = ['department', 'shift', 'summary'].filter((k) => body[k] !== undefined)
  if (meta.length > 0) {
    await db.run(
      `UPDATE inspections SET ${meta.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @at WHERE id = @id`,
      { ...Object.fromEntries(meta.map((k) => [k, body[k]])), at: now(), id: inspection.id }
    )
  }

  return c.json(await resolveInspection(db, inspection.id))
})

/** Reset: throw the partial away and start clean. Drafts only. */
inspections.delete('/:id', requirePermission('inspection.create'), async (c) => {
  const inspection = await loadScoped(c)
  assertOwnEditable(c, inspection, 'A submitted inspection cannot be discarded')

  await c.get('db').run('DELETE FROM inspections WHERE id = @id', { id: inspection.id })
  return c.body(null, 204)
})

const signatureSchema = z.object({
  role: z.enum(SIGNATURE_ROLES).default('inspector'),
  // Typed, not looked up: a department supervisor usually has no account here.
  name: z.string().min(2).max(120),
  // A PNG data URL from the signature pad.
  image: z.string().min(1),
})

/**
 * Sign an inspection.
 *
 * The inspector signs their own, while it is still a draft - a signature on a
 * record you can no longer change is the wrong way round, and one on a record
 * you can still change afterwards is worthless. Hence: sign, then submit, and
 * submitting is what freezes it.
 *
 * The supervisor's countersignature is captured on the same device at the end of
 * the walkround, which is the only moment both people are standing together.
 */
inspections.post('/:id/signature', requirePermission('inspection.create'), validateBody(signatureSchema), async (c) => {
  const db = c.get('db')
  const body = c.get('body')
  const inspection = await loadScoped(c)

  if (!isEditable(inspection)) {
    throw fail(409, 'This inspection has been submitted and can no longer be signed', {
      code: 'INSPECTION_LOCKED',
    })
  }
  if (inspection.inspector_id !== c.get('user').id) {
    throw fail(403, 'This inspection belongs to another inspector')
  }

  const problem = validateSignatureImage(body.image)
  if (problem) throw fail(422, problem)

  await putSignature(db, inspection.id, {
    role: body.role,
    name: body.name,
    image: body.image,
    capturedBy: c.get('user').id,
  })
  return c.json(await resolveInspection(db, inspection.id), 201)
})

/** Remove a signature, while the inspection is still open. */
inspections.delete('/:id/signature/:role', requirePermission('inspection.create'), async (c) => {
  const inspection = await loadScoped(c)
  assertOwnEditable(c, inspection, 'This inspection has been submitted and can no longer be changed')

  await c.get('db').run(
    'DELETE FROM inspection_signatures WHERE inspection_id = @id AND role = @role',
    { id: inspection.id, role: c.req.param('role') }
  )
  return c.body(null, 204)
})

/** Hand it in. From here the inspector can no longer change it. */
inspections.post('/:id/submit', requirePermission('inspection.create'), async (c) => {
  const db = c.get('db')
  const inspection = await loadScoped(c)
  assertOwnEditable(c, inspection, 'This inspection has already been submitted')

  // The inspector's signature is what makes this a statement rather than a
  // draft. Checked before the findings so the inspector is not asked to fix
  // descriptions and only then told they still have to sign.
  if (!(await hasSignature(db, inspection.id, 'inspector'))) {
    throw fail(422, 'Sign the inspection before submitting it', { code: 'SIGNATURE_REQUIRED' })
  }

  const resolved = await resolveInspection(db, inspection.id)

  // A finding without a description is not actionable by whoever has to fix it.
  const undescribed = resolved.sections
    .flatMap((s) => s.items)
    .filter((i) => isException(i.rating) && !i.note.trim())
  if (undescribed.length > 0) {
    throw fail(422, `${undescribed.length} finding(s) need a description before submission`, {
      items: undescribed.slice(0, 10).map((i) => ({ code: i.code, text: i.text })),
    })
  }

  await db.run(`UPDATE inspections SET status = 'submitted', submitted_at = @at WHERE id = @id`, {
    at: now(),
    id: inspection.id,
  })
  return c.json(await resolveInspection(db, inspection.id))
})

/** Sign off. Freezes the record permanently. */
inspections.post('/:id/sign', requirePermission('inspection.sign'), async (c) => {
  const db = c.get('db')
  const inspection = await loadScoped(c)

  if (inspection.status !== 'submitted') throw fail(409, 'Only a submitted inspection can be signed off')
  // Sign-off is a second pair of eyes; it is not a second signature from the person
  // who carried out the inspection.
  if (inspection.inspector_id === c.get('user').id) {
    throw fail(409, 'An inspection cannot be signed off by its own inspector')
  }

  await db.run(`UPDATE inspections SET status = 'signed', signed_at = @at, signed_by = @by WHERE id = @id`, {
    at: now(),
    by: c.get('user').id,
    id: inspection.id,
  })
  return c.json(await resolveInspection(db, inspection.id))
})

inspections.get('/', requirePermission('inspection.view'), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const clauses = ['u.tenant_id = @tenant']
  const params = { tenant: user.tenantId }

  if (user.unitIds !== null) {
    if (user.unitIds.length === 0) return c.json([])
    clauses.push(`i.unit_id IN (${db.idList(user.unitIds)})`)
  }
  if (c.req.query('unit_id')) {
    clauses.push('i.unit_id = @unit_id')
    params.unit_id = Number(c.req.query('unit_id'))
  }
  if (c.req.query('status')) {
    clauses.push('i.status = @status')
    params.status = c.req.query('status')
  }

  return c.json(
    await db.all(
      `SELECT i.*, u.name AS unit_name, us.full_name AS inspector_name,
              (SELECT COUNT(*) FROM inspection_items ii
               WHERE ii.inspection_id = i.id
                 AND ii.rating IN ('needs_improvement', 'critical')) AS exception_count
       FROM inspections i
       JOIN units u ON u.id = i.unit_id
       JOIN users us ON us.id = i.inspector_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY i.updated_at DESC
       LIMIT 200`,
      params
    )
  )
})

inspections.get('/:id', requirePermission('inspection.view'), async (c) =>
  c.json(await resolveInspection(c.get('db'), (await loadScoped(c)).id))
)

export default inspections
