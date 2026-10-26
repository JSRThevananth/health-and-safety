import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { requirePermission, requireUnitAccess } from '../middleware/auth.js'

const router = Router()

const unitSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
  location: z.string().max(200).default(''),
  timezone: z.string().max(60).default('UTC'),
})

/** Admins see every unit in their tenant; everyone else sees only their assigned units. */
router.get('/', requirePermission('unit.view'), (req, res) => {
  const db = getDb()
  if (req.user.unitIds === null) {
    return res.json(
      db.prepare('SELECT * FROM units WHERE tenant_id = ? AND active = 1 ORDER BY name').all(req.user.tenantId)
    )
  }
  if (req.user.unitIds.length === 0) return res.json([])

  const placeholders = req.user.unitIds.map(() => '?').join(',')
  res.json(
    db
      .prepare(
        `SELECT * FROM units WHERE tenant_id = ? AND active = 1 AND id IN (${placeholders}) ORDER BY name`
      )
      .all(req.user.tenantId, ...req.user.unitIds)
  )
})

router.get(
  '/:unit_id',
  requirePermission('unit.view'),
  requireUnitAccess(),
  asyncHandler(async (req, res) => {
    const unit = getDb()
      .prepare('SELECT * FROM units WHERE id = ? AND tenant_id = ?')
      .get(req.params.unit_id, req.user.tenantId)
    if (!unit) return res.status(404).json({ error: 'Unit not found' })
    res.json(unit)
  })
)

router.post(
  '/',
  requirePermission('unit.manage'),
  validate(unitSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const clash = db
      .prepare('SELECT id FROM units WHERE tenant_id = ? AND code = ?')
      .get(req.user.tenantId, req.body.code)
    if (clash) return res.status(409).json({ error: `Unit code "${req.body.code}" already exists` })

    const result = db
      .prepare(
        `INSERT INTO units (tenant_id, name, code, location, timezone)
         VALUES (@tenant_id, @name, @code, @location, @timezone)`
      )
      .run({ ...req.body, tenant_id: req.user.tenantId })

    res.status(201).json(db.prepare('SELECT * FROM units WHERE id = ?').get(result.lastInsertRowid))
  })
)

router.patch(
  '/:unit_id',
  requirePermission('unit.manage'),
  validate(unitSchema.partial()),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const unit = db
      .prepare('SELECT * FROM units WHERE id = ? AND tenant_id = ?')
      .get(req.params.unit_id, req.user.tenantId)
    if (!unit) return res.status(404).json({ error: 'Unit not found' })

    const next = { ...unit, ...req.body }
    db.prepare('UPDATE units SET name = ?, code = ?, location = ?, timezone = ? WHERE id = ?').run(
      next.name, next.code, next.location, next.timezone, unit.id
    )
    res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(unit.id))
  })
)

/** Deactivate rather than delete: inspection history must keep pointing at a real unit. */
router.delete(
  '/:unit_id',
  requirePermission('unit.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const unit = db
      .prepare('SELECT * FROM units WHERE id = ? AND tenant_id = ?')
      .get(req.params.unit_id, req.user.tenantId)
    if (!unit) return res.status(404).json({ error: 'Unit not found' })

    db.prepare('UPDATE units SET active = 0 WHERE id = ?').run(unit.id)
    res.status(204).end()
  })
)

export default router
