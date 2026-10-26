import { Hono } from 'hono'
import { z } from 'zod'
import { hashPassword, verifyPassword, DUMMY_HASH, MIN_PIN_LENGTH } from '../crypto.js'
import { now } from '../db.js'
import { issueToken, requireAuth } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { fail } from '../middleware/errors.js'
import { effectivePermissions, accessibleUnitIds } from '../services/permissions.js'

const auth = new Hono()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // Which organisation to sign in to. Optional while a deployment has a single
  // tenant; required once there are several.
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

/**
 * Count recent failed sign-ins, in the database rather than in memory.
 *
 * A Worker runs in whichever data centre is nearest the request, and each one
 * starts with its own empty memory. An in-process counter would therefore give an
 * attacker the full allowance again from every city they tried.
 */
async function recentFailures(db, { username, ip, windowMinutes }) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const row = await db.get(
    `SELECT
       SUM(CASE WHEN username = @username THEN 1 ELSE 0 END) AS by_user,
       SUM(CASE WHEN ip = @ip AND @ip <> '' THEN 1 ELSE 0 END) AS by_ip
     FROM login_attempts WHERE created_at >= @since`,
    { username, ip, since }
  )
  return Math.max(row?.by_user || 0, row?.by_ip || 0)
}

auth.post('/login', validateBody(loginSchema), async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const { username, password, tenant: slug } = c.get('body')
  const ip = c.req.header('cf-connecting-ip') || ''

  const failures = await recentFailures(db, { username, ip, windowMinutes: config.login.windowMinutes })
  if (failures >= config.login.maxFailures) {
    throw fail(429, `Too many sign-in attempts. Try again in ${config.login.windowMinutes} minutes.`)
  }

  let tenant
  if (slug) {
    tenant = await db.get('SELECT * FROM tenants WHERE slug = @slug AND active = 1', { slug })
  } else {
    const tenants = await db.all('SELECT * FROM tenants WHERE active = 1 LIMIT 2')
    if (tenants.length > 1) throw fail(400, 'Multiple organisations available - specify "tenant"')
    tenant = tenants[0]
  }

  const user = tenant
    ? await db.get('SELECT * FROM users WHERE tenant_id = @t AND username = @u AND active = 1', {
        t: tenant.id,
        u: username,
      })
    : null

  // Hash against a dummy even when the user is unknown, so the response time does
  // not reveal which usernames exist.
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH)

  if (!user || !ok) {
    await db.run(
      'INSERT INTO login_attempts (username, ip, created_at) VALUES (@username, @ip, @at)',
      { username, ip, at: now() }
    )
    throw fail(401, 'Invalid credentials')
  }

  // Only failures are counted, so a busy shared office is never locked out by its
  // own successful sign-ins.
  await db.run('DELETE FROM login_attempts WHERE username = @u', { u: username })

  const principal = {
    permissions: await effectivePermissions(db, user.id, user.role),
    unitIds: await accessibleUnitIds(db, user.id, user.role),
  }

  return c.json({
    access_token: await issueToken(user, config),
    token_type: 'bearer',
    user: publicUser(user, principal),
  })
})

auth.get('/me', requireAuth, async (c) => {
  const user = await c.get('db').get('SELECT * FROM users WHERE id = @id', { id: c.get('user').id })
  if (!user) throw fail(404, 'User not found')
  return c.json(publicUser(user, c.get('user')))
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(MIN_PIN_LENGTH, `Use at least ${MIN_PIN_LENGTH} characters`),
})

/**
 * Set a new password. Used both for the forced first-sign-in change and for a
 * voluntary change later, so it always requires the current password.
 */
auth.post('/change-password', requireAuth, validateBody(changePasswordSchema), async (c) => {
  const db = c.get('db')
  const body = c.get('body')
  const user = await db.get('SELECT * FROM users WHERE id = @id', { id: c.get('user').id })
  if (!user) throw fail(404, 'User not found')

  if (!(await verifyPassword(body.current_password, user.password_hash))) {
    throw fail(401, 'Current password is incorrect')
  }
  // Otherwise a forced change could be satisfied by re-entering the temporary one.
  if (body.current_password === body.new_password) {
    throw fail(422, 'New password must be different from the current one')
  }

  await db.run(
    `UPDATE users SET password_hash = @hash, must_change_password = 0, password_changed_at = @at
     WHERE id = @id`,
    { hash: await hashPassword(body.new_password), at: now(), id: user.id }
  )

  const updated = await db.get('SELECT * FROM users WHERE id = @id', { id: user.id })
  return c.json({ status: 'ok', user: publicUser(updated, c.get('user')) })
})

export default auth
