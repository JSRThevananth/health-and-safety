import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

function setup() {
  const rt = createRuntime({
    config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 'test-secret-value-long-enough' },
  })
  rt.load('Config.gs', 'Schema.gs', 'Db.gs', 'Crypto.gs', 'Permissions.gs', 'Auth.gs')
  const s = rt.sandbox
  s.ensureSchema()

  const tenant = s.dbInsert('Tenants', { name: 'Acme', slug: 'acme', active: 1 })
  const unitA = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Heathrow', code: 'LHR', active: 1 })
  const unitB = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Dubai', code: 'DXB', active: 1 })

  const make = (username, role, password, units, mustChange) => {
    const salt = s.generateSalt()
    const u = s.dbInsert('Users', {
      tenant_id: tenant.id, username, email: username + '@example.com',
      full_name: username, role,
      password_salt: salt, password_hash: s.hashPassword(password, salt),
      must_change_password: mustChange ? 1 : 0, active: 1,
    })
    ;(units || []).forEach((unitId) => s.dbInsert('UserUnits', { user_id: u.id, unit_id: unitId }))
    return u
  }

  const omni = make('omni', 'omni_admin', 'omni-password-1', [], false)
  const manager = make('manager', 'unit_admin', 'manager-password-1', [unitA.id], false)
  const inspector = make('inspector', 'inspector', 'inspector-password-1', [unitA.id], false)
  const fresh = make('newbie', 'inspector', 'temporary-issued-1', [unitA.id], true)

  return { rt, s, tenant, unitA, unitB, omni, manager, inspector, fresh }
}

test('signing in returns a token, scope and permissions', () => {
  const { s, unitA } = setup()
  const result = s.login('manager', 'manager-password-1')

  assert.ok(result.token)
  assert.equal(result.user.role, 'unit_admin')
  assert.deepEqual([...result.user.unit_ids], [unitA.id])
  assert.ok(result.user.permissions.includes('template.edit'))
  assert.equal(result.user.permissions.includes('user.manage'), false)
})

test('the password hash and salt never reach the client', () => {
  const { s } = setup()
  const result = s.login('omni', 'omni-password-1')
  const serialised = JSON.stringify(result)

  assert.equal(serialised.includes('password_hash'), false)
  assert.equal(serialised.includes('password_salt'), false)
  assert.equal(serialised.includes('omni-password-1'), false)
})

test('an omni admin is tenant-wide, signalled by a null unit scope', () => {
  const { s } = setup()
  assert.equal(s.login('omni', 'omni-password-1').user.unit_ids, null)
})

test('a wrong password and an unknown user fail identically', () => {
  const { s } = setup()
  let wrongPassword, unknownUser
  try { s.login('manager', 'nope') } catch (e) { wrongPassword = e.message }
  try { s.login('ghost', 'nope') } catch (e) { unknownUser = e.message }

  assert.equal(wrongPassword, 'Invalid credentials')
  assert.equal(unknownUser, 'Invalid credentials', 'must not reveal which usernames exist')
})

test('repeated failures are throttled', () => {
  const { s } = setup()
  for (let i = 0; i < 10; i += 1) {
    assert.throws(() => s.login('manager', 'wrong'), /Invalid credentials/)
  }
  assert.throws(() => s.login('manager', 'wrong'), /Too many sign-in attempts/)
  // Even the correct password is refused while the window is open.
  assert.throws(() => s.login('manager', 'manager-password-1'), /Too many sign-in attempts/)
})

test('a successful sign-in clears the failure count', () => {
  const { s } = setup()
  for (let i = 0; i < 5; i += 1) {
    try { s.login('manager', 'wrong') } catch (e) { /* expected */ }
  }
  assert.ok(s.login('manager', 'manager-password-1').token)
  for (let i = 0; i < 9; i += 1) {
    try { s.login('manager', 'wrong') } catch (e) { /* expected */ }
  }
  // Would already be locked out had the counter not reset.
  assert.ok(s.login('manager', 'manager-password-1').token)
})

test('a token resolves back to the right caller', () => {
  const { s, inspector } = setup()
  const { token } = s.login('inspector', 'inspector-password-1')
  const principal = s.principalFromToken(token)

  assert.equal(principal.id, inspector.id)
  assert.equal(principal.role, 'inspector')
  assert.equal(principal.permissions.includes('inspection.sign'), false)
})

test('deactivating an account invalidates a token already issued', () => {
  const { s, inspector } = setup()
  const { token } = s.login('inspector', 'inspector-password-1')
  assert.ok(s.principalFromToken(token))

  s.dbUpdate('Users', inspector.id, { active: 0 })
  assert.equal(s.principalFromToken(token), null, 'a live token must not outlive the account')
})

test('revoking a permission takes effect immediately, not at token expiry', () => {
  const { s, manager } = setup()
  const { token } = s.login('manager', 'manager-password-1')
  assert.ok(s.principalFromToken(token).permissions.includes('template.edit'))

  s.dbInsert('UserPermissions', { user_id: manager.id, permission: 'template.edit', granted: 0 })
  s.dbResetCache()

  assert.equal(s.principalFromToken(token).permissions.includes('template.edit'), false)
})

test('a temporary password blocks everything until it is changed', () => {
  const { s } = setup()
  const { token } = s.login('newbie', 'temporary-issued-1')
  const principal = s.principalFromToken(token)

  assert.equal(principal.mustChangePassword, true)

  let caught = null
  try { s.requirePasswordChanged(principal) } catch (e) { caught = e }
  assert.ok(caught, 'must refuse while a temporary password is in force')
  assert.equal(caught.code, 'PASSWORD_CHANGE_REQUIRED')
})

test('the forced change cannot be satisfied by re-entering the same password', () => {
  const { s } = setup()
  const { token } = s.login('newbie', 'temporary-issued-1')
  const principal = s.principalFromToken(token)

  assert.throws(
    () => s.changePassword(principal, 'temporary-issued-1', 'temporary-issued-1'),
    /must be different/
  )
})

test('changing the password clears the requirement and retires the old one', () => {
  const { s } = setup()
  const { token } = s.login('newbie', 'temporary-issued-1')
  const updated = s.changePassword(s.principalFromToken(token), 'temporary-issued-1', 'chosen-by-me-99')

  assert.equal(updated.must_change_password, false)
  assert.throws(() => s.login('newbie', 'temporary-issued-1'), /Invalid credentials/)
  assert.ok(s.login('newbie', 'chosen-by-me-99').token)
})

test('a short new password is refused', () => {
  const { s } = setup()
  const { token } = s.login('newbie', 'temporary-issued-1')
  assert.throws(
    () => s.changePassword(s.principalFromToken(token), 'temporary-issued-1', 'short'),
    /at least 8 characters/
  )
})

test('unit scoping matches the Node build', () => {
  const { s, unitA, unitB } = setup()
  const manager = s.principalFromToken(s.login('manager', 'manager-password-1').token)
  const omni = s.principalFromToken(s.login('omni', 'omni-password-1').token)

  assert.equal(s.canAccessUnit(manager, unitA.id), true)
  assert.equal(s.canAccessUnit(manager, unitB.id), false)
  assert.equal(s.canAccessUnit(omni, unitB.id), true, 'omni reaches every unit')

  assert.throws(() => s.requireUnitAccess(manager, unitB.id), /No access to this unit/)
})
