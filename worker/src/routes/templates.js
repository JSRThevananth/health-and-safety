import { Hono } from 'hono'
import { z } from 'zod'
import { now } from '../db.js'
import { validateBody } from '../middleware/validate.js'
import { requirePermission, requireUnitAccess } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { getLibrary } from '../services/library.js'
import {
  createDraft,
  getDraftTemplate,
  getPublishedTemplate,
  resolveTemplate,
  publishDraft,
} from '../services/formTemplates.js'

// Mounted at /units/:unit_id/template so unit scoping applies to every route here.
const templates = new Hono()

templates.use('*', requireUnitAccess('unit_id'))

/** Confirm the unit exists inside the caller's tenant before touching its form. */
async function unitOf(c) {
  const unit = await c.get('db').get('SELECT * FROM units WHERE id = @id AND tenant_id = @t', {
    id: c.req.param('unit_id'),
    t: c.get('user').tenantId,
  })
  if (!unit) throw fail(404, 'Unit not found')
  return unit
}

async function draftOf(c) {
  const draft = await getDraftTemplate(c.get('db'), c.req.param('unit_id'))
  if (!draft) throw fail(404, 'No open draft for this unit')
  return draft
}

/** The master library, for picking items to add back into a unit's form. */
templates.get('/library', requirePermission('template.view'), async (c) => {
  await unitOf(c)
  return c.json(await getLibrary(c.get('db'), c.get('user').tenantId))
})

/** The unit's live checklist - what an inspection would use right now. */
templates.get('/', requirePermission('template.view'), async (c) => {
  await unitOf(c)
  const published = await getPublishedTemplate(c.get('db'), c.req.param('unit_id'))
  if (!published) throw fail(404, 'This unit has no published checklist yet')
  return c.json(await resolveTemplate(c.get('db'), published.id))
})

templates.get('/versions', requirePermission('template.view'), async (c) => {
  await unitOf(c)
  return c.json(
    await c.get('db').all('SELECT * FROM unit_templates WHERE unit_id = @u ORDER BY version DESC', {
      u: c.req.param('unit_id'),
    })
  )
})

/** An archived version, so a historical inspection can be rendered as it was signed. */
templates.get('/versions/:version', requirePermission('template.view'), async (c) => {
  await unitOf(c)
  const template = await c.get('db').get(
    'SELECT * FROM unit_templates WHERE unit_id = @u AND version = @v',
    { u: c.req.param('unit_id'), v: c.req.param('version') }
  )
  if (!template) throw fail(404, 'Version not found')
  return c.json(await resolveTemplate(c.get('db'), template.id))
})

/** Open (or return) the unit's working draft. */
templates.post('/draft', requirePermission('template.edit'), async (c) => {
  const unit = await unitOf(c)
  const draft = await createDraft(c.get('db'), unit.id, c.get('user').tenantId, c.get('user').id)
  return c.json(await resolveTemplate(c.get('db'), draft.id), 201)
})

templates.get('/draft', requirePermission('template.edit'), async (c) => {
  await unitOf(c)
  return c.json(await resolveTemplate(c.get('db'), (await draftOf(c)).id))
})

const editSchema = z.object({
  sections: z
    .array(z.object({ section_id: z.coerce.number().int().positive(), enabled: z.boolean() }))
    .default([]),
  items: z
    .array(
      z.object({
        id: z.coerce.number().int().positive(),
        enabled: z.boolean().optional(),
        // null clears a rewording and restores the library wording.
        text_override: z.string().min(1).max(500).nullable().optional(),
        risk_weight: z.number().min(0).max(10).nullable().optional(),
        sort_order: z.coerce.number().int().min(0).optional(),
      })
    )
    .default([]),
})

/** Apply edits to the draft: enable/disable, reword, reweight, reorder. */
templates.patch('/draft', requirePermission('template.edit'), validateBody(editSchema), async (c) => {
  await unitOf(c)
  const db = c.get('db')
  const draft = await draftOf(c)
  const body = c.get('body')

  // Every id must belong to this draft, so one unit cannot edit another's form.
  const ownIds = new Set(
    await db.pluck('SELECT id FROM unit_template_items WHERE template_id = @t', { t: draft.id })
  )
  const stray = body.items.find((i) => !ownIds.has(i.id))
  if (stray) throw fail(422, `Item ${stray.id} is not part of this draft`)

  const statements = body.sections.map((s) =>
    db.stmt('UPDATE unit_template_sections SET enabled = @e WHERE template_id = @t AND section_id = @s', {
      e: s.enabled ? 1 : 0,
      t: draft.id,
      s: s.section_id,
    })
  )

  for (const item of body.items) {
    const fields = []
    const params = { id: item.id, template_id: draft.id }
    if (item.enabled !== undefined) {
      fields.push('enabled = @enabled')
      params.enabled = item.enabled ? 1 : 0
    }
    if (item.text_override !== undefined) {
      fields.push('text_override = @text_override')
      params.text_override = item.text_override
    }
    if (item.risk_weight !== undefined) {
      fields.push('risk_weight = @risk_weight')
      params.risk_weight = item.risk_weight
    }
    if (item.sort_order !== undefined) {
      fields.push('sort_order = @sort_order')
      params.sort_order = item.sort_order
    }
    if (fields.length === 0) continue
    statements.push(
      db.stmt(
        `UPDATE unit_template_items SET ${fields.join(', ')} WHERE id = @id AND template_id = @template_id`,
        params
      )
    )
  }

  await db.batch(statements)
  return c.json(await resolveTemplate(db, draft.id))
})

const customItemSchema = z.object({
  section_id: z.coerce.number().int().positive(),
  group_id: z.coerce.number().int().positive().nullish(),
  text: z.string().min(1).max(500),
  risk_weight: z.number().min(0).max(10).default(1),
})

/** Add a unit-specific item that does not exist in the shared library. */
templates.post('/draft/items', requirePermission('template.edit'), validateBody(customItemSchema), async (c) => {
  await unitOf(c)
  const db = c.get('db')
  const draft = await draftOf(c)
  const body = c.get('body')

  const section = await db.get('SELECT id FROM library_sections WHERE id = @id AND tenant_id = @t', {
    id: body.section_id,
    t: c.get('user').tenantId,
  })
  if (!section) throw fail(422, 'Unknown section')

  const { id: customId } = await db.insert(
    `INSERT INTO unit_custom_items (unit_id, section_id, group_id, text, risk_weight, created_by, created_at)
     VALUES (@unit_id, @section_id, @group_id, @text, @risk_weight, @created_by, @at)`,
    {
      unit_id: c.req.param('unit_id'),
      section_id: body.section_id,
      group_id: body.group_id ?? null,
      text: body.text,
      risk_weight: body.risk_weight,
      created_by: c.get('user').id,
      at: now(),
    }
  )

  const { n } = await db.get(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM unit_template_items WHERE template_id = @t',
    { t: draft.id }
  )
  await db.run(
    `INSERT INTO unit_template_items (template_id, custom_item_id, enabled, sort_order)
     VALUES (@t, @c, 1, @n)`,
    { t: draft.id, c: customId, n }
  )

  return c.json(await resolveTemplate(db, draft.id), 201)
})

templates.post('/draft/publish', requirePermission('template.edit'), async (c) => {
  await unitOf(c)
  const draft = await draftOf(c)
  const result = await publishDraft(c.get('db'), draft.id)
  if (result.error) throw fail(result.status, result.error)
  return c.json(await resolveTemplate(c.get('db'), result.template.id))
})

/** Abandon the draft. Published versions are untouched. */
templates.delete('/draft', requirePermission('template.edit'), async (c) => {
  await unitOf(c)
  const draft = await draftOf(c)
  await c.get('db').run('DELETE FROM unit_templates WHERE id = @id', { id: draft.id })
  return c.body(null, 204)
})

export default templates
