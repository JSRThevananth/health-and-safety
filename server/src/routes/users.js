import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { PERMISSIONS, ROLE_PRESETS, effectivePermissions } from '../services/permissions.js'

const router = Router()

const ROLES = ['omni_admin', 'unit_admin', 'inspector', 'viewer']

const userSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  email: z.string().email(),
  full_name: z.string().min(1).max(120),
  initials: z.string().max(12).default(''),
  role: z.enum(ROLES),
  password: z.string().min(8, 'Use at least 8 characters'),
  unit_ids: z.array(z.coerce.number().int().positive()).default([]),
})

const updateSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(1).max(120).optional(),
  initials: z.string().max(12).optional(),
  role: z.enum(ROLES).optional(),
  password: z.string().min(8).optional(),
  active: z.boolean().optional(),
  unit_ids: z.array(z.coerce.number().int().positive()).optional(),
})

const permissionSchema = z.object({
  // permission -> true (grant), false (revoke), or null (fall back to the role preset)
  overrides: z.record(z.enum(PERMISSIONS), z.boolean().nullable()),
})

const shape = (db, user) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  full_name: user.full_name,
  initials: user.initials,
  role: user.role,
  active: Boolean(user.active),
  must_change_password: Boolean(user.must_change_password),
  password_changed_at: user.password_changed_at,
  unit_ids:
    user.role === 'omni_admin'
      ? null // admins are tenant-wide, not assigned to specific units
      : db.prepare('SELECT unit_id FROM user_units WHERE user_id = ?').all(user.id).map((r) => r.unit_id),
  permissions: [...effectivePermissions(user.id, user.role)].sort(),
})

/** Verify every unit belongs to this tenant, so a user cannot be attached across tenants. */
function assertUnitsInTenant(db, tenantId, unitIds) {
  if (unitIds.length === 0) return null
  const placeholders = unitIds.map(() => '?').join(',')
  const found = db
    .prepare(`SELECT id FROM units WHERE tenant_id = ? AND id IN (${placeholders})`)
    .all(tenantId, ...unitIds)
    .map((r) => r.id)
  const missing = unitIds.filter((id) => !found.includes(id))
  return missing.length ? `Unknown unit(s): ${missing.join(', ')}` : null
}

router.get('/', requirePermission('user.manage'), (req, res) => {
  const db = getDb()
  const users = db
    .prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY full_name')
    .all(req.user.tenantId)
  res.json(users.map((u) => shape(db, u)))
})

/** Reference data for the admin UI: available roles and what each one grants by default. */
router.get('/roles', requirePermission('user.manage'), (req, res) => {
  res.json({
    roles: ROLES.map((role) => ({
      role,
      tenant_wide: role === 'omni_admin',
      default_permissions: ROLE_PRESETS[role],
    })),
    all_permissions: PERMISSIONS,
  })
})

router.post(
  '/',
  requirePermission('user.manage'),
  validate(userSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const { password, unit_ids, ...fields } = req.body

    const taken = db
      .prepare('SELECT id FROM users WHERE tenant_id = ? AND username = ?')
      .get(req.user.tenantId, fields.username)
    if (taken) return res.status(409).json({ error: `Username "${fields.username}" is taken` })

    // A non-admin with no units cannot see anything, which is a silent dead end.
    if (fields.role !== 'omni_admin' && unit_ids.length === 0) {
      return res.status(422).json({ error: `Role "${fields.role}" must be assigned at least one unit` })
    }
    const unitError = assertUnitsInTenant(db, req.user.tenantId, unit_ids)
    if (unitError) return res.status(422).json({ error: unitError })

    const create = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO users (tenant_id, username, email, full_name, initials, role, password_hash)
           VALUES (@tenant_id, @username, @email, @full_name, @initials, @role, @password_hash)`
        )
        .run({ ...fields, tenant_id: req.user.tenantId, password_hash: bcrypt.hashSync(password, 10) })

      const userId = Number(result.lastInsertRowid)
      if (fields.role !== 'omni_admin') {
        const link = db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)')
        for (const unitId of unit_ids) link.run(userId, unitId)
      }
      return userId
    })

    const id = create()
    res.status(201).json(shape(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id)))
  })
)

router.get(
  '/:id',
  requirePermission('user.manage'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const user = db
      .prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, req.user.tenantId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(shape(db, user))
  })
)

router.patch(
  '/:id',
  requirePermission('user.manage'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const user = db
      .prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, req.user.tenantId)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const { password, unit_ids, active, ...fields } = req.body
    const next = { ...user, ...fields }

    // Guard against an admin removing their own access and locking the tenant out.
    const losingAdmin =
      user.role === 'omni_admin' && ((next.role && next.role !== 'omni_admin') || active === false)
    if (losingAdmin) {
      const others = db
        .prepare(
          `SELECT COUNT(*) AS n FROM users
           WHERE tenant_id = ? AND role = 'omni_admin' AND active = 1 AND id <> ?`
        )
        .get(req.user.tenantId, user.id).n
      if (others === 0) {
        return res.status(409).json({ error: 'Cannot remove the last active admin for this tenant' })
      }
    }

    const targetUnits = unit_ids ?? null
    if (targetUnits) {
      const unitError = assertUnitsInTenant(db, req.user.tenantId, targetUnits)
      if (unitError) return res.status(422).json({ error: unitError })
    }
    if (next.role !== 'omni_admin') {
      const resulting = targetUnits ?? db.prepare('SELECT unit_id FROM user_units WHERE user_id = ?').all(user.id)
      if (resulting.length === 0) {
        return res.status(422).json({ error: `Role "${next.role}" must be assigned at least one unit` })
      }
    }

    const apply = db.transaction(() => {
      db.prepare(
        `UPDATE users SET email = ?, full_name = ?, initials = ?, role = ?, active = ?
         ${password ? ", password_hash = ?, must_change_password = 1, password_changed_at = NULL" : ''}
         WHERE id = ?`
      ).run(
        ...[
          next.email,
          next.full_name,
          next.initials,
          next.role,
          active === undefined ? user.active : Number(active),
          ...(password ? [bcrypt.hashSync(password, 10)] : []),
          user.id,
        ]
      )

      // Admins are tenant-wide, so clear any stale unit assignments on promotion.
      if (next.role === 'omni_admin') {
        db.prepare('DELETE FROM user_units WHERE user_id = ?').run(user.id)
      } else if (targetUnits) {
        db.prepare('DELETE FROM user_units WHERE user_id = ?').run(user.id)
        const link = db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)')
        for (const unitId of targetUnits) link.run(user.id, unitId)
      }
    })

    apply()
    res.json(shape(db, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)))
  })
)

/** Grant or revoke individual capabilities on top of the user's role preset. */
router.put(
  '/:id/permissions',
  requirePermission('user.manage'),
  validate(permissionSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const user = db
      .prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?')
      .get(req.params.id, req.user.tenantId)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const apply = db.transaction(() => {
      const clear = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?')
      const set = db.prepare(
        `INSERT INTO user_permissions (user_id, permission, granted) VALUES (?, ?, ?)
         ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted`
      )
      for (const [permission, value] of Object.entries(req.body.overrides)) {
        if (value === null) clear.run(user.id, permission)
        else set.run(user.id, permission, value ? 1 : 0)
      }
    })

    apply()
    res.json(shape(db, user))
  })
)

export default router
