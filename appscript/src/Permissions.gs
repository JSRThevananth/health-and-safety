/**
 * Roles, capabilities and unit scoping.
 *
 * Routes name a capability rather than a role, so an admin can tune one person's
 * access without a new role having to be invented for them.
 */
const PERMISSIONS = [
  'unit.view', 'unit.manage',
  'template.view', 'template.edit',
  'inspection.view', 'inspection.create', 'inspection.sign', 'inspection.delete',
  'capa.create', 'capa.assign', 'capa.close',
  'recipient.manage',
  'user.manage',
  'report.view', 'report.export',
  'message.send',
  'attachment.upload', 'attachment.delete',
  'audit.view',
];

const ROLE_PRESETS = {
  // Spans every unit in the tenant.
  omni_admin: PERMISSIONS.slice(),

  // Runs one unit end to end, including its checklist and its report recipients,
  // but cannot create users or reach another unit.
  unit_admin: [
    'unit.view', 'template.view', 'template.edit',
    'inspection.view', 'inspection.create', 'inspection.sign',
    'capa.create', 'capa.assign', 'capa.close',
    'recipient.manage', 'report.view', 'report.export', 'message.send',
    'attachment.upload', 'attachment.delete',
  ],

  // Walks the floor. Cannot sign off or close its own findings.
  inspector: [
    'unit.view', 'template.view', 'inspection.view', 'inspection.create',
    'capa.create', 'report.view', 'message.send', 'attachment.upload',
  ],

  // Read-only, e.g. a visiting auditor.
  viewer: ['unit.view', 'template.view', 'inspection.view', 'report.view'],
};

/** Role preset, plus explicit grants, minus explicit revokes. */
function effectivePermissions(userId, role) {
  const base = {};
  (ROLE_PRESETS[role] || []).forEach(function (p) { base[p] = true; });

  dbFind('UserPermissions', function (r) { return Number(r.user_id) === Number(userId); })
    .forEach(function (row) {
      // Ignore names left over from an older release rather than trusting them.
      if (PERMISSIONS.indexOf(row.permission) === -1) return;
      if (Number(row.granted) === 1) base[row.permission] = true;
      else delete base[row.permission];
    });

  return Object.keys(base).sort();
}

/**
 * Units this user may act on. An omni admin returns null, meaning no restriction -
 * callers must read null as "every unit in the tenant", never as "none".
 */
function accessibleUnitIds(userId, role) {
  if (role === 'omni_admin') return null;
  return dbFind('UserUnits', function (r) { return Number(r.user_id) === Number(userId); })
    .map(function (r) { return Number(r.unit_id); });
}

function canAccessUnit(principal, unitId) {
  if (principal.unitIds === null) return true;
  return principal.unitIds.indexOf(Number(unitId)) !== -1;
}

function hasPermission(principal, permission) {
  return principal.permissions.indexOf(permission) !== -1;
}

/** Throw the error the UI shows if the caller lacks a capability. */
function requirePermission(principal, permission) {
  if (!hasPermission(principal, permission)) {
    throw new Error('Missing permission: ' + permission);
  }
}

function requireUnitAccess(principal, unitId) {
  if (!canAccessUnit(principal, unitId)) throw new Error('No access to this unit');
}
