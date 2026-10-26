/**
 * Every capability in the app. Routes name one of these rather than checking roles
 * directly, so an admin can tune a single user's access without a code change.
 */
export const PERMISSIONS = Object.freeze([
  'unit.view',
  'unit.manage',
  'template.view',
  'template.edit',
  'inspection.view',
  'inspection.create',
  'inspection.sign',
  'inspection.delete',
  'capa.create',
  'capa.assign',
  'capa.close',
  'recipient.manage',
  'user.manage',
  'report.view',
  'report.export',
  'message.send',
  'attachment.upload',
  'attachment.delete',
  'audit.view',
])

const ALL = new Set(PERMISSIONS)

/** Default capability set per role. Admin is handled separately - it gets everything. */
export const ROLE_PRESETS = Object.freeze({
  admin: PERMISSIONS,

  // Walks the floor and fills in checklists. Cannot sign off or close its own
  // findings - but can send the report for an inspection they have submitted,
  // because pressing "send report" at the end of the walk is the job, and making
  // an inspector wait for a manager to forward it is how findings go cold.
  inspector: [
    'unit.view',
    'template.view',
    'inspection.view',
    'inspection.create',
    'capa.create',
    'report.view',
    'report.export',
    'message.send',
    'attachment.upload',
  ],

  // Read-only stakeholder, e.g. a visiting auditor.
  viewer: ['unit.view', 'template.view', 'inspection.view', 'report.view'],
})

/**
 * Resolve a user's effective permissions: their role preset, plus explicit grants and
 * minus explicit revokes from user_permissions.
 */
export async function effectivePermissions(db, userId, role) {
  const base = new Set(ROLE_PRESETS[role] || [])
  const overrides = await db.all('SELECT permission, granted FROM user_permissions WHERE user_id = @id', {
    id: userId,
  })

  for (const { permission, granted } of overrides) {
    if (!ALL.has(permission)) continue // ignore stale names from an older release
    if (granted) base.add(permission)
    else base.delete(permission)
  }
  return base
}

/**
 * Units a user may act on. Admins are tenant-wide, so they return null meaning
 * "no restriction" - callers must treat null as all units within the tenant.
 */
export async function accessibleUnitIds(db, userId, role) {
  if (role === 'admin') return null
  return db.pluck('SELECT unit_id FROM user_units WHERE user_id = @id', { id: userId })
}

export function canAccessUnit(principal, unitId) {
  if (principal.unitIds === null) return true
  return principal.unitIds.includes(Number(unitId))
}
