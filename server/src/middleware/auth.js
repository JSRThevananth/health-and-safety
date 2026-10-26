import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { getDb } from '../db/index.js'
import { effectivePermissions, accessibleUnitIds, canAccessUnit } from '../services/permissions.js'

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role, tenant: user.tenant_id },
    config.auth.jwtSecret,
    { expiresIn: config.auth.tokenTtl }
  )
}

/**
 * Verify the bearer token and load the caller's live role, units and permissions.
 *
 * Permissions are read from the database on each request rather than trusted from the
 * token, so revoking a user's access takes effect immediately instead of when their
 * token happens to expire.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing bearer token' })

  let payload
  try {
    payload = jwt.verify(token, config.auth.jwtSecret)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const user = getDb()
    .prepare(
      'SELECT id, tenant_id, username, role, active, must_change_password FROM users WHERE id = ?'
    )
    .get(Number(payload.sub))
  if (!user || !user.active) return res.status(401).json({ error: 'Account is inactive' })

  req.user = {
    id: user.id,
    tenantId: user.tenant_id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
    permissions: effectivePermissions(user.id, user.role),
    unitIds: accessibleUnitIds(user.id, user.role), // null means tenant-wide
  }
  next()
}

/** Gate a route on a named capability from services/permissions.js. */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    if (!req.user.permissions.has(permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}` })
    }
    next()
  }
}

/**
 * Enforce unit scoping: a limited user may only act on units assigned to them.
 * Reads the unit id from the route param, body, or query, in that order.
 */
export function requireUnitAccess(field = 'unit_id') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })

    const raw = req.params[field] ?? req.body?.[field] ?? req.query?.[field]
    if (raw === undefined) return res.status(400).json({ error: `Missing ${field}` })

    if (!canAccessUnit(req.user, raw)) {
      // Deliberately the same message whether the unit is out of scope or absent, so
      // a limited user cannot probe for the existence of other units.
      return res.status(403).json({ error: 'No access to this unit' })
    }
    next()
  }
}

// Routes a user may reach while still holding an admin-issued temporary password.
const PASSWORD_CHANGE_EXEMPT = new Set(['/auth/me', '/auth/change-password', '/auth/login'])

/**
 * Block the API until a first-time user has chosen their own password. Without
 * this the forced change would be advisory - a client could simply skip the screen
 * and keep using the temporary credential the admin issued.
 */
export function requirePasswordChanged(req, res, next) {
  if (!req.user?.mustChangePassword) return next()
  if (PASSWORD_CHANGE_EXEMPT.has(req.path) || PASSWORD_CHANGE_EXEMPT.has(req.baseUrl + req.path)) {
    return next()
  }
  res.status(403).json({
    error: 'Password change required before continuing',
    code: 'PASSWORD_CHANGE_REQUIRED',
  })
}
