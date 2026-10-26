import { readToken, signToken } from '../crypto.js'
import { effectivePermissions, accessibleUnitIds, canAccessUnit } from '../services/permissions.js'
import { fail } from './errors.js'

export const issueToken = (user, config) =>
  signToken(
    { sub: String(user.id), username: user.username, role: user.role, tenant: user.tenant_id },
    config.auth.secret,
    config.auth.ttlSeconds
  )

/**
 * Verify the bearer token and load the caller's live role, units and permissions.
 *
 * Permissions are read from the database on each request rather than trusted from
 * the token, so revoking a user's access takes effect immediately instead of when
 * their token happens to expire.
 */
export async function requireAuth(c, next) {
  const header = c.req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw fail(401, 'Missing bearer token')

  const payload = await readToken(token, c.get('config').auth.secret)
  if (!payload) throw fail(401, 'Invalid or expired token')

  const db = c.get('db')
  const user = await db.get(
    'SELECT id, tenant_id, username, role, active, must_change_password FROM users WHERE id = @id',
    { id: Number(payload.sub) }
  )
  if (!user || !user.active) throw fail(401, 'Account is inactive')

  c.set('user', {
    id: user.id,
    tenantId: user.tenant_id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    permissions: await effectivePermissions(db, user.id, user.role),
    unitIds: await accessibleUnitIds(db, user.id, user.role), // null means tenant-wide
  })
  await next()
}

/** Gate a route on a named capability from services/permissions.js. */
export const requirePermission = (permission) => async (c, next) => {
  if (!c.get('user').permissions.has(permission)) {
    throw fail(403, `Missing permission: ${permission}`)
  }
  await next()
}

/**
 * Enforce unit scoping: a limited user may only act on units assigned to them.
 * Reads the unit id from the route param, then the query string, then the body.
 */
export const requireUnitAccess = (field = 'unit_id') => async (c, next) => {
  const raw = c.req.param(field) ?? c.req.query(field) ?? c.get('body')?.[field]
  if (raw === undefined) throw fail(400, `Missing ${field}`)

  // Deliberately the same message whether the unit is out of scope or absent, so a
  // limited user cannot probe for the existence of other units.
  if (!canAccessUnit(c.get('user'), raw)) throw fail(403, 'No access to this unit')
  await next()
}

// Routes a user may reach while still holding an admin-issued temporary password.
const PASSWORD_CHANGE_EXEMPT = new Set(['/api/auth/me', '/api/auth/change-password'])

/**
 * Block the API until a first-time user has chosen their own password. Without
 * this the forced change would be advisory - a client could simply skip the screen
 * and keep using the temporary credential the admin issued.
 */
export async function requirePasswordChanged(c, next) {
  if (!c.get('user').mustChangePassword) return next()
  if (PASSWORD_CHANGE_EXEMPT.has(new URL(c.req.url).pathname)) return next()
  throw fail(403, 'Password change required before continuing', { code: 'PASSWORD_CHANGE_REQUIRED' })
}
