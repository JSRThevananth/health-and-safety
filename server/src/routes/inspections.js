import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { canAccessUnit } from '../services/permissions.js'
import {
  RATINGS,
  openDraft,
  resolveInspection,
  applyItems,
  isEditable,
  isException,
} from '../services/inspections.js'

const router = Router()

/** Load an inspection and confirm the caller's unit scope covers it. */
function loadScoped(req, res) {
  const inspection = getDb().prepare('SELECT * FROM inspections WHERE id = ?').get(req.params.id)
  // Same response whether it is missing or out of scope, so a limited user cannot
  // probe for the existence of other units' inspections.
  if (!inspection || !canAccessUnit(req.user, inspection.unit_id)) {
    res.status(404).json({ error: 'Inspection not found' })
    return null
  }
  return inspection
}

const unitQuery = z.object({ unit_id: z.coerce.number().int().positive() })

/** Resume: the caller's open draft for a unit, if there is one. */
router.get(
  '/draft',
  requirePermission('inspection.create'),
  validate(unitQuery, 'query'),
  asyncHandler(async (req, res) => {
    if (!canAccessUnit(req.user, req.query.unit_id)) {
      return res.status(403).json({ error: 'No access to this unit' })
    }
    const draft = getDb()
      .prepare(`SELECT id FROM inspections WHERE unit_id = ? AND inspector_id = ? AND status = 'draft'`)
      .get(req.query.unit_id, req.user.id)
    if (!draft) return res.status(404).json({ error: 'No inspection in progress' })
    res.json(resolveInspection(draft.id))
  })
)

/** Start, or pick up where they left off. */
router.post(
  '/draft',
  requirePermission('inspection.create'),
  validate(unitQuery),
  asyncHandler(async (req, res) => {
    if (!canAccessUnit(req.user, req.body.unit_id)) {
      return res.status(403).json({ error: 'No access to this unit' })
    }
    const result = openDraft(req.body.unit_id, req.user.id)
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(result.created ? 201 : 200).json(resolveInspection(result.inspection.id))
  })
)

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
router.patch(
  '/:id',
  requirePermission('inspection.create'),
  validate(saveSchema),
  asyncHandler(async (req, res) => {
    const inspection = loadScoped(req, res)
    if (!inspection) return

    if (inspection.inspector_id !== req.user.id) {
      return res.status(403).json({ error: 'This inspection belongs to another inspector' })
    }
    if (!isEditable(inspection)) {
      return res.status(409).json({
        error: 'This inspection has been submitted and can no longer be changed',
        code: 'INSPECTION_LOCKED',
      })
    }

    if (req.body.items.length > 0) {
      const result = applyItems(inspection.id, req.body.items)
      if (result.error) return res.status(result.status).json({ error: result.error })
    }

    const meta = ['department', 'shift', 'summary'].filter((k) => req.body[k] !== undefined)
    if (meta.length > 0) {
      getDb()
        .prepare(
          `UPDATE inspections SET ${meta.map((k) => `${k} = ?`).join(', ')},
           updated_at = datetime('now') WHERE id = ?`
        )
        .run(...meta.map((k) => req.body[k]), inspection.id)
    }

    res.json(resolveInspection(inspection.id))
  })
)

/** Reset: throw the partial away and start clean. Drafts only. */
router.delete(
  '/:id',
  requirePermission('inspection.create'),
  asyncHandler(async (req, res) => {
    const inspection = loadScoped(req, res)
    if (!inspection) return

    if (inspection.inspector_id !== req.user.id) {
      return res.status(403).json({ error: 'This inspection belongs to another inspector' })
    }
    if (!isEditable(inspection)) {
      return res.status(409).json({ error: 'A submitted inspection cannot be discarded' })
    }

    getDb().prepare('DELETE FROM inspections WHERE id = ?').run(inspection.id)
    res.status(204).end()
  })
)

/** Hand it in. From here the inspector can no longer change it. */
router.post(
  '/:id/submit',
  requirePermission('inspection.create'),
  asyncHandler(async (req, res) => {
    const inspection = loadScoped(req, res)
    if (!inspection) return

    if (inspection.inspector_id !== req.user.id) {
      return res.status(403).json({ error: 'This inspection belongs to another inspector' })
    }
    if (!isEditable(inspection)) {
      return res.status(409).json({ error: 'This inspection has already been submitted' })
    }

    const resolved = resolveInspection(inspection.id)

    // A finding without a description is not actionable by whoever has to fix it.
    const undescribed = resolved.sections
      .flatMap((s) => s.items)
      .filter((i) => isException(i.rating) && !i.note.trim())
    if (undescribed.length > 0) {
      return res.status(422).json({
        error: `${undescribed.length} finding(s) need a description before submission`,
        items: undescribed.slice(0, 10).map((i) => ({ code: i.code, text: i.text })),
      })
    }

    getDb()
      .prepare(`UPDATE inspections SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`)
      .run(inspection.id)

    res.json(resolveInspection(inspection.id))
  })
)

/** Sign off. Freezes the record permanently. */
router.post(
  '/:id/sign',
  requirePermission('inspection.sign'),
  asyncHandler(async (req, res) => {
    const inspection = loadScoped(req, res)
    if (!inspection) return

    if (inspection.status !== 'submitted') {
      return res.status(409).json({ error: 'Only a submitted inspection can be signed off' })
    }
    // Sign-off is a second pair of eyes; it is not a second signature from the
    // person who carried out the inspection.
    if (inspection.inspector_id === req.user.id) {
      return res.status(409).json({ error: 'An inspection cannot be signed off by its own inspector' })
    }

    getDb()
      .prepare(`UPDATE inspections SET status = 'signed', signed_at = datetime('now'), signed_by = ? WHERE id = ?`)
      .run(req.user.id, inspection.id)

    res.json(resolveInspection(inspection.id))
  })
)

router.get(
  '/',
  requirePermission('inspection.view'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const clauses = ['u.tenant_id = @tenant']
    const params = { tenant: req.user.tenantId }

    if (req.user.unitIds !== null) {
      if (req.user.unitIds.length === 0) return res.json([])
      clauses.push(`i.unit_id IN (${req.user.unitIds.join(',')})`)
    }
    if (req.query.unit_id) {
      clauses.push('i.unit_id = @unit_id')
      params.unit_id = Number(req.query.unit_id)
    }
    if (req.query.status) {
      clauses.push('i.status = @status')
      params.status = req.query.status
    }

    res.json(
      db
        .prepare(
          `SELECT i.*, u.name AS unit_name, us.full_name AS inspector_name,
                  (SELECT COUNT(*) FROM inspection_items ii
                   WHERE ii.inspection_id = i.id
                     AND ii.rating IN ('needs_improvement', 'critical')) AS exception_count
           FROM inspections i
           JOIN units u ON u.id = i.unit_id
           JOIN users us ON us.id = i.inspector_id
           WHERE ${clauses.join(' AND ')}
           ORDER BY i.updated_at DESC
           LIMIT 200`
        )
        .all(params)
    )
  })
)

router.get(
  '/:id',
  requirePermission('inspection.view'),
  asyncHandler(async (req, res) => {
    const inspection = loadScoped(req, res)
    if (!inspection) return
    res.json(resolveInspection(inspection.id))
  })
)

export default router
