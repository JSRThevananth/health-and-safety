import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { effectivePermissions, accessibleUnitIds } from '../services/permissions.js'
import { validate, asyncHandler } from '../middleware/validate.js'

const router = Router()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // Which organisation to sign in to. Optional while a deployment has a single
  // tenant; required once there are several (production resolves it by subdomain).
  tenant: z.string().min(1).optional(),
})

const publicUser = (user, principal) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  full_name: user.full_name,
  initials: user.initials,
  role: user.role,
  tenant_id: user.tenant_id,
  must_change_password: Boolean(user.must_change_password),
  // null unit_ids means tenant-wide access (admin); the UI keys its nav off this.
  unit_ids: principal.unitIds,
  permissions: [...principal.permissions].sort(),
})

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()

    let tenant
    if (req.body.tenant) {
      tenant = db.prepare('SELECT * FROM tenants WHERE slug = ? AND active = 1').get(req.body.tenant)
    } else {
      const tenants = db.prepare('SELECT * FROM tenants WHERE active = 1 LIMIT 2').all()
      if (tenants.length > 1) {
        return res.status(400).json({ error: 'Multiple organisations available - specify "tenant"' })
      }
      tenant = tenants[0]
    }

    const user = tenant
      ? db
          .prepare('SELECT * FROM users WHERE tenant_id = ? AND username = ? AND active = 1')
          .get(tenant.id, req.body.username)
      : null

    // Compare against a dummy hash when the user is unknown so the response time does
    // not reveal which usernames exist.
    const hash = user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
    const ok = await bcrypt.compare(req.body.password, hash)
    if (!user || !ok) return res.status(401).json({ error: 'Invalid credentials' })

    const principal = {
      permissions: effectivePermissions(user.id, user.role),
      unitIds: accessibleUnitIds(user.id, user.role),
    }
    res.json({
      access_token: signToken(user),
      token_type: 'bearer',
      user: publicUser(user, principal),
    })
  })
)

router.get('/me', requireAuth, (req, res) => {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(publicUser(user, req.user))
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Use at least 8 characters'),
})

/**
 * Set a new password. Used both for the forced first-sign-in change and for a
 * voluntary change later, so it always requires the current password.
 */
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const ok = await bcrypt.compare(req.body.current_password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' })

    // Otherwise a forced change could be satisfied by re-entering the temporary one.
    if (req.body.current_password === req.body.new_password) {
      return res.status(422).json({ error: 'New password must be different from the current one' })
    }

    db.prepare(
      `UPDATE users
       SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now')
       WHERE id = ?`
    ).run(bcrypt.hashSync(req.body.new_password, 10), user.id)

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
    res.json({ status: 'ok', user: publicUser(updated, req.user) })
  })
)

export default router
