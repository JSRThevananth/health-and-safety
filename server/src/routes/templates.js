import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { requirePermission, requireUnitAccess } from '../middleware/auth.js'
import { getLibrary } from '../services/library.js'
import {
  createDraft,
  getDraftTemplate,
  getPublishedTemplate,
  resolveTemplate,
  publishDraft,
} from '../services/formTemplates.js'

// Mounted at /units/:unit_id/template so unit scoping applies to every route here.
const router = Router({ mergeParams: true })

const unitBelongsToTenant = (req) =>
  getDb()
    .prepare('SELECT * FROM units WHERE id = ? AND tenant_id = ?')
    .get(req.params.unit_id, req.user.tenantId)

router.use(requireUnitAccess('unit_id'))

/** The master library, for picking items to add back into a unit's form. */
router.get(
  '/library',
  requirePermission('template.view'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    res.json(getLibrary(req.user.tenantId))
  })
)

/** The unit's live checklist - what an inspection would use right now. */
router.get(
  '/',
  requirePermission('template.view'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const published = getPublishedTemplate(req.params.unit_id)
    if (!published) return res.status(404).json({ error: 'This unit has no published checklist yet' })
    res.json(resolveTemplate(published.id))
  })
)

router.get(
  '/versions',
  requirePermission('template.view'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    res.json(
      getDb()
        .prepare('SELECT * FROM unit_templates WHERE unit_id = ? ORDER BY version DESC')
        .all(req.params.unit_id)
    )
  })
)

/** An archived version, so a historical inspection can be rendered as it was signed. */
router.get(
  '/versions/:version',
  requirePermission('template.view'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const template = getDb()
      .prepare('SELECT * FROM unit_templates WHERE unit_id = ? AND version = ?')
      .get(req.params.unit_id, req.params.version)
    if (!template) return res.status(404).json({ error: 'Version not found' })
    res.json(resolveTemplate(template.id))
  })
)

/** Open (or return) the unit's working draft. */
router.post(
  '/draft',
  requirePermission('template.edit'),
  asyncHandler(async (req, res) => {
    const unit = unitBelongsToTenant(req)
    if (!unit) return res.status(404).json({ error: 'Unit not found' })
    const draft = createDraft(unit.id, req.user.tenantId, req.user.id)
    res.status(201).json(resolveTemplate(draft.id))
  })
)

router.get(
  '/draft',
  requirePermission('template.edit'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const draft = getDraftTemplate(req.params.unit_id)
    if (!draft) return res.status(404).json({ error: 'No open draft for this unit' })
    res.json(resolveTemplate(draft.id))
  })
)

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
router.patch(
  '/draft',
  requirePermission('template.edit'),
  validate(editSchema),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const db = getDb()
    const draft = getDraftTemplate(req.params.unit_id)
    if (!draft) return res.status(404).json({ error: 'No open draft for this unit' })

    // Every id must belong to this draft, so one unit cannot edit another's form.
    const ownIds = new Set(
      db.prepare('SELECT id FROM unit_template_items WHERE template_id = ?').all(draft.id)
        .map((r) => r.id)
    )
    const stray = req.body.items.find((i) => !ownIds.has(i.id))
    if (stray) return res.status(422).json({ error: `Item ${stray.id} is not part of this draft` })

    const apply = db.transaction(() => {
      const setSection = db.prepare(
        'UPDATE unit_template_sections SET enabled = ? WHERE template_id = ? AND section_id = ?'
      )
      for (const s of req.body.sections) setSection.run(s.enabled ? 1 : 0, draft.id, s.section_id)

      for (const item of req.body.items) {
        const fields = []
        const values = []
        if (item.enabled !== undefined) { fields.push('enabled = ?'); values.push(item.enabled ? 1 : 0) }
        if (item.text_override !== undefined) { fields.push('text_override = ?'); values.push(item.text_override) }
        if (item.risk_weight !== undefined) { fields.push('risk_weight = ?'); values.push(item.risk_weight) }
        if (item.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(item.sort_order) }
        if (fields.length === 0) continue
        values.push(item.id, draft.id)
        db.prepare(`UPDATE unit_template_items SET ${fields.join(', ')} WHERE id = ? AND template_id = ?`)
          .run(...values)
      }
    })

    apply()
    res.json(resolveTemplate(draft.id))
  })
)

const customItemSchema = z.object({
  section_id: z.coerce.number().int().positive(),
  group_id: z.coerce.number().int().positive().nullish(),
  text: z.string().min(1).max(500),
  risk_weight: z.number().min(0).max(10).default(1),
})

/** Add a unit-specific item that does not exist in the shared library. */
router.post(
  '/draft/items',
  requirePermission('template.edit'),
  validate(customItemSchema),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const db = getDb()
    const draft = getDraftTemplate(req.params.unit_id)
    if (!draft) return res.status(404).json({ error: 'No open draft for this unit' })

    const section = db
      .prepare('SELECT id FROM library_sections WHERE id = ? AND tenant_id = ?')
      .get(req.body.section_id, req.user.tenantId)
    if (!section) return res.status(422).json({ error: 'Unknown section' })

    const add = db.transaction(() => {
      const customId = Number(
        db
          .prepare(
            `INSERT INTO unit_custom_items (unit_id, section_id, group_id, text, risk_weight, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            req.params.unit_id, req.body.section_id, req.body.group_id ?? null,
            req.body.text, req.body.risk_weight, req.user.id
          ).lastInsertRowid
      )
      const nextOrder =
        db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM unit_template_items WHERE template_id = ?')
          .get(draft.id).n
      db.prepare(
        `INSERT INTO unit_template_items (template_id, custom_item_id, enabled, sort_order)
         VALUES (?, ?, 1, ?)`
      ).run(draft.id, customId, nextOrder)
    })

    add()
    res.status(201).json(resolveTemplate(draft.id))
  })
)

router.post(
  '/draft/publish',
  requirePermission('template.edit'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const draft = getDraftTemplate(req.params.unit_id)
    if (!draft) return res.status(404).json({ error: 'No open draft for this unit' })

    const result = publishDraft(draft.id)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.json(resolveTemplate(result.template.id))
  })
)

/** Abandon the draft. Published versions are untouched. */
router.delete(
  '/draft',
  requirePermission('template.edit'),
  asyncHandler(async (req, res) => {
    if (!unitBelongsToTenant(req)) return res.status(404).json({ error: 'Unit not found' })
    const draft = getDraftTemplate(req.params.unit_id)
    if (!draft) return res.status(404).json({ error: 'No open draft for this unit' })
    getDb().prepare('DELETE FROM unit_templates WHERE id = ?').run(draft.id)
    res.status(204).end()
  })
)

export default router
