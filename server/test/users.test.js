import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'


const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

const db = getDb()
const fx = seedTenant(db)
const server = await startServer(createApp)
test.after(() => server.close())

const tokenFor = async (username, password = 'password123', tenant = 'acme') =>
  (await server.request('POST', '/auth/login', { json: { username, password, tenant } }))
    .body.access_token

const admin = await tokenFor('admin')

test('a newly created user must set their own password before reaching anything', async () => {
  const created = await server.request('POST', '/users', {
    token: admin,
    json: {
      username: 'dxb.manager',
      email: 'dxb@example.com',
      full_name: 'Dubai H&S Manager',
      role: 'unit_admin',
      password: 'temp-issued-12345',
      unit_ids: [fx.unitB],
    },
  })
  assert.equal(created.status, 201)
  assert.deepEqual(created.body.unit_ids, [fx.unitB])
  assert.equal(created.body.must_change_password, true)

  const token = await tokenFor('dxb.manager', 'temp-issued-12345')

  // The temporary password authenticates, but opens nothing.
  const blocked = await server.request('GET', '/units', { token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')

  // The client still needs to know who it is in order to render the change screen.
  const me = await server.request('GET', '/auth/me', { token })
  assert.equal(me.status, 200)
  assert.equal(me.body.must_change_password, true)

  const changed = await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temp-issued-12345', new_password: 'chosen-by-user-1' },
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.body.user.must_change_password, false)

  // Same session, now unblocked, and still scoped to Dubai alone.
  const units = await server.request('GET', '/units', { token })
  assert.equal(units.status, 200)
  assert.equal(units.body.length, 1)
  assert.equal(units.body[0].id, fx.unitB, 'must see Dubai only, never Heathrow')
})

test('a non-admin user must be assigned at least one unit', async () => {
  const { status, body } = await server.request('POST', '/users', {
    token: admin,
    json: {
      username: 'orphan',
      email: 'orphan@example.com',
      full_name: 'Orphan',
      role: 'inspector',
      password: 'secret12345',
      unit_ids: [],
    },
  })
  assert.equal(status, 422)
  assert.match(body.error, /must be assigned at least one unit/)
})

test('users cannot be attached to a unit in another tenant', async () => {
  const other = seedTenant(db, { slug: 'other' })
  // A second tenant now exists, so every later login must name its organisation.
  const { status, body } = await server.request('POST', '/users', {
    token: admin,
    json: {
      username: 'crosstenant',
      email: 'x@example.com',
      full_name: 'Cross Tenant',
      role: 'inspector',
      password: 'secret12345',
      unit_ids: [other.unitA],
    },
  })
  assert.equal(status, 422)
  assert.match(body.error, /Unknown unit/)
})

test('duplicate usernames are rejected', async () => {
  const { status } = await server.request('POST', '/users', {
    token: admin,
    json: {
      username: 'admin',
      email: 'dupe@example.com',
      full_name: 'Duplicate',
      role: 'inspector',
      password: 'secret12345',
      unit_ids: [fx.unitA],
    },
  })
  assert.equal(status, 409)
})

test('weak passwords are rejected', async () => {
  const { status, body } = await server.request('POST', '/users', {
    token: admin,
    json: {
      username: 'weakpass',
      email: 'weak@example.com',
      full_name: 'Weak',
      role: 'inspector',
      password: 'short',
      unit_ids: [fx.unitA],
    },
  })
  assert.equal(status, 422)
  assert.equal(body.issues[0].path, 'password')
})

test('an extra capability can be granted to one limited user', async () => {
  // The inspector preset excludes capa.close; grant it to this individual only.
  const before = await server.request('GET', `/users/${fx.inspector}`, { token: admin })
  assert.equal(before.body.permissions.includes('capa.close'), false)

  const granted = await server.request('PUT', `/users/${fx.inspector}/permissions`, {
    token: admin,
    json: { overrides: { 'capa.close': true } },
  })
  assert.ok(granted.body.permissions.includes('capa.close'))

  // The grant must take effect on an existing session, not just on the next login.
  const token = await tokenFor('inspector')
  const me = await server.request('GET', '/auth/me', { token })
  assert.ok(me.body.permissions.includes('capa.close'))
})

test('a capability can be revoked below the role preset', async () => {
  const revoked = await server.request('PUT', `/users/${fx.manager}/permissions`, {
    token: admin,
    json: { overrides: { 'template.edit': false } },
  })
  assert.equal(revoked.body.permissions.includes('template.edit'), false)
})

test('null clears an override and restores the role default', async () => {
  await server.request('PUT', `/users/${fx.manager}/permissions`, {
    token: admin,
    json: { overrides: { 'template.edit': null } },
  })
  const restored = await server.request('GET', `/users/${fx.manager}`, { token: admin })
  assert.ok(restored.body.permissions.includes('template.edit'))
})

test('unknown permission names are rejected', async () => {
  const { status } = await server.request('PUT', `/users/${fx.manager}/permissions`, {
    token: admin,
    json: { overrides: { 'not.a.permission': true } },
  })
  assert.equal(status, 422)
})

test('the last active admin cannot be demoted or deactivated', async () => {
  const demote = await server.request('PATCH', `/users/${fx.admin}`, {
    token: admin,
    json: { role: 'viewer', unit_ids: [fx.unitA] },
  })
  assert.equal(demote.status, 409)
  assert.match(demote.body.error, /last active admin/)

  const deactivate = await server.request('PATCH', `/users/${fx.admin}`, {
    token: admin,
    json: { active: false },
  })
  assert.equal(deactivate.status, 409)
})

test('a deactivated user is denied immediately, mid-session', async () => {
  const token = await tokenFor('viewer')
  assert.equal((await server.request('GET', '/auth/me', { token })).status, 200)

  await server.request('PATCH', `/users/${fx.viewer}`, { token: admin, json: { active: false } })

  const after = await server.request('GET', '/auth/me', { token })
  assert.equal(after.status, 401, 'a still-valid token must not outlive the account')
})

test('promoting a user to admin clears their unit assignments', async () => {
  const promoted = await server.request('PATCH', `/users/${fx.inspector}`, {
    token: admin,
    json: { role: 'omni_admin' },
  })
  assert.equal(promoted.status, 200)
  assert.equal(promoted.body.unit_ids, null)

  const token = await tokenFor('inspector')
  const units = await server.request('GET', '/units', { token })
  assert.ok(units.body.length >= 2, 'a promoted admin sees the whole tenant')
})
