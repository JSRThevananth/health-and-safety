import { Hono } from 'hono'
import { z } from 'zod'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../crypto.js'
import { validateBody } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { PERMISSIONS, ROLE_PRESETS, effectivePermissions } from '../services/permissions.js'

const users = new Hono()

const ROLES = ['omni_admin', 'unit_admin', 'inspector', 'viewer']

const userSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only'),
  email: z.string().email(),
  full_name: z.string().min(1).max(120),
  initials: z.string().max(12).default(''),
  role: z.enum(ROLES),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
  unit_ids: z.array(z.coerce.number().int().positive()).default([]),
})

const updateSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(1).max(120).optional(),
  initials: z.string().max(12).optional(),
  role: z.enum(ROLES).optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
  active: z.boolean().optional(),
  unit_ids: z.array(z.coerce.number().int().positive()).optional(),
})

const permissionSchema = z.object({
  // permission -> true (grant), false (revoke), or null (fall back to the role preset)
  overrides: z.record(z.enum(PERMISSIONS), z.boolean().nullable()),
})

async function shape(db, user) {
  return {
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
        ? null // omni admins are tenant-wide, not assigned to specific units
        : await db.pluck('SELECT unit_id FROM user_units WHERE user_id = @id', { id: user.id }),
    permissions: [...(await effectivePermissions(db, user.id, user.role))].sort(),
  }
}

/** Verify every unit belongs to this tenant, so a user cannot be attached across tenants. */
async function assertUnitsInTenant(db, tenantId, unitIds) {
  if (unitIds.length === 0) return null
  const found = await db.pluck(
    `SELECT id FROM units WHERE tenant_id = @t AND id IN (${db.idList(unitIds)})`,
    { t: tenantId }
  )
  const missing = unitIds.filter((id) => !found.includes(id))
  return missing.length ? `Unknown unit(s): ${missing.join(', ')}` : null
}

const loadUser = async (c) =>
  c.get('db').get('SELECT * FROM users WHERE id = @id AND tenant_id = @t', {
    id: c.req.param('id'),
    t: c.get('user').tenantId,
  })

users.get('/', requirePermission('user.manage'), async (c) => {
  const db = c.get('db')
  const rows = await db.all('SELECT * FROM users WHERE tenant_id = @t ORDER BY full_name', {
    t: c.get('user').tenantId,
  })
  return c.json(await Promise.all(rows.map((u) => shape(db, u))))
})

/** Reference data for the admin UI: available roles and what each grants by default. */
users.get('/roles', requirePermission('user.manage'), (c) =>
  c.json({
    roles: ROLES.map((role) => ({
      role,
      tenant_wide: role === 'omni_admin',
      default_permissions: ROLE_PRESETS[role],
    })),
    all_permissions: PERMISSIONS,
  })
)

users.post('/', requirePermission('user.manage'), validateBody(userSchema), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('user').tenantId
  const { password, unit_ids, ...fields } = c.get('body')

  const taken = await db.get('SELECT id FROM users WHERE tenant_id = @t AND username = @u', {
    t: tenantId,
    u: fields.username,
  })
  if (taken) throw fail(409, `Username "${fields.username}" is taken`)

  // A non-admin with no units cannot see anything, which is a silent dead end.
  if (fields.role !== 'omni_admin' && unit_ids.length === 0) {
    throw fail(422, `Role "${fields.role}" must be assigned at least one unit`)
  }
  const unitError = await assertUnitsInTenant(db, tenantId, unit_ids)
  if (unitError) throw fail(422, unitError)

  const { id } = await db.insert(
    `INSERT INTO users (tenant_id, username, email, full_name, initials, role, password_hash)
     VALUES (@tenant_id, @username, @email, @full_name, @initials, @role, @password_hash)`,
    { ...fields, tenant_id: tenantId, password_hash: await hashPassword(password) }
  )

  // The user row has to exist before its unit links can reference it, and D1 cannot
  // hold a transaction across the two. A user with no links is visibly broken rather
  // than silently over-privileged, so it fails safe; the links still go in together.
  if (fields.role !== 'omni_admin') {
    await db.batch(
      db.bulkInsert(
        'user_units',
        ['user_id', 'unit_id'],
        unit_ids.map((unitId) => ({ user_id: id, unit_id: unitId }))
      )
    )
  }

  return c.json(await shape(db, await db.get('SELECT * FROM users WHERE id = @id', { id })), 201)
})

users.get('/:id', requirePermission('user.manage'), async (c) => {
  const user = await loadUser(c)
  if (!user) throw fail(404, 'User not found')
  return c.json(await shape(c.get('db'), user))
})

users.patch('/:id', requirePermission('user.manage'), validateBody(updateSchema), async (c) => {
  const db = c.get('db')
  const tenantId = c.get('user').tenantId
  const user = await loadUser(c)
  if (!user) throw fail(404, 'User not found')

  const { password, unit_ids, active, ...fields } = c.get('body')
  const next = { ...user, ...fields }

  // Guard against an admin removing their own access and locking the tenant out.
  const losingAdmin =
    user.role === 'omni_admin' && ((next.role && next.role !== 'omni_admin') || active === false)
  if (losingAdmin) {
    const { n } = await db.get(
      `SELECT COUNT(*) AS n FROM users
       WHERE tenant_id = @t AND role = 'omni_admin' AND active = 1 AND id <> @id`,
      { t: tenantId, id: user.id }
    )
    if (n === 0) throw fail(409, 'Cannot remove the last active admin for this tenant')
  }

  const targetUnits = unit_ids ?? null
  if (targetUnits) {
    const unitError = await assertUnitsInTenant(db, tenantId, targetUnits)
    if (unitError) throw fail(422, unitError)
  }
  if (next.role !== 'omni_admin') {
    const resulting =
      targetUnits ?? (await db.pluck('SELECT unit_id FROM user_units WHERE user_id = @id', { id: user.id }))
    if (resulting.length === 0) {
      throw fail(422, `Role "${next.role}" must be assigned at least one unit`)
    }
  }

  const statements = [
    db.stmt(
      `UPDATE users SET email = @email, full_name = @full_name, initials = @initials,
         role = @role, active = @active
       ${password ? ', password_hash = @hash, must_change_password = 1, password_changed_at = NULL' : ''}
       WHERE id = @id`,
      {
        email: next.email,
        full_name: next.full_name,
        initials: next.initials,
        role: next.role,
        active: active === undefined ? user.active : Number(active),
        ...(password ? { hash: await hashPassword(password) } : {}),
        id: user.id,
      }
    ),
  ]

  // Omni admins are tenant-wide, so clear any stale unit assignments on promotion.
  if (next.role === 'omni_admin') {
    statements.push(db.stmt('DELETE FROM user_units WHERE user_id = @id', { id: user.id }))
  } else if (targetUnits) {
    statements.push(db.stmt('DELETE FROM user_units WHERE user_id = @id', { id: user.id }))
    statements.push(
      ...db.bulkInsert(
        'user_units',
        ['user_id', 'unit_id'],
        targetUnits.map((unitId) => ({ user_id: user.id, unit_id: unitId }))
      )
    )
  }

  await db.batch(statements)
  return c.json(await shape(db, await db.get('SELECT * FROM users WHERE id = @id', { id: user.id })))
})

/** Grant or revoke individual capabilities on top of the user's role preset. */
users.put('/:id/permissions', requirePermission('user.manage'), validateBody(permissionSchema), async (c) => {
  const db = c.get('db')
  const user = await loadUser(c)
  if (!user) throw fail(404, 'User not found')

  const statements = Object.entries(c.get('body').overrides).map(([permission, value]) =>
    value === null
      ? db.stmt('DELETE FROM user_permissions WHERE user_id = @id AND permission = @p', {
          id: user.id,
          p: permission,
        })
      : db.stmt(
          `INSERT INTO user_permissions (user_id, permission, granted) VALUES (@id, @p, @g)
           ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted`,
          { id: user.id, p: permission, g: value ? 1 : 0 }
        )
  )

  await db.batch(statements)
  return c.json(await shape(db, user))
})

export default users
