import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'


const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

const db = getDb()
// Both organisations have a user called "admin" - the case that a global unique
// constraint on username would have made impossible.
const acme = seedTenant(db, { slug: 'acme' })
const globex = seedTenant(db, { slug: 'globex' })

const server = await startServer(createApp)
test.after(() => server.close())

const login = (username, tenant) =>
  server.request('POST', '/auth/login', { json: { username, password: 'password123', tenant } })

test('the same username can exist in two organisations', async () => {
  const a = await login('admin', 'acme')
  const b = await login('admin', 'globex')
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.notEqual(a.body.user.id, b.body.user.id)
  assert.notEqual(a.body.user.tenant_id, b.body.user.tenant_id)
})

test('an admin sees only their own organisation units', async () => {
  const a = await login('admin', 'acme')
  const b = await login('admin', 'globex')

  const acmeUnits = await server.request('GET', '/units', { token: a.body.access_token })
  const globexUnits = await server.request('GET', '/units', { token: b.body.access_token })

  const acmeIds = acmeUnits.body.map((u) => u.id).sort()
  const globexIds = globexUnits.body.map((u) => u.id).sort()
  assert.deepEqual(acmeIds, [acme.unitA, acme.unitB].sort())
  assert.deepEqual(globexIds, [globex.unitA, globex.unitB].sort())
  assert.equal(acmeIds.some((id) => globexIds.includes(id)), false, 'no unit may leak across tenants')
})

test('one tenant admin cannot read another tenant unit', async () => {
  const a = await login('admin', 'acme')
  const { status } = await server.request('GET', `/units/${globex.unitA}`, {
    token: a.body.access_token,
  })
  assert.equal(status, 404, 'a cross-tenant unit must not be readable')
})

test('one tenant admin cannot list or modify another tenant users', async () => {
  const a = await login('admin', 'acme')
  const users = await server.request('GET', '/users', { token: a.body.access_token })
  const ids = users.body.map((u) => u.id)
  assert.equal(ids.includes(globex.admin), false, 'user list must not cross tenants')

  const patched = await server.request('PATCH', `/users/${globex.manager}`, {
    token: a.body.access_token,
    json: { full_name: 'Hijacked' },
  })
  assert.equal(patched.status, 404)
})

test('login must name the organisation when several exist', async () => {
  const { status, body } = await server.request('POST', '/auth/login', {
    json: { username: 'admin', password: 'password123' },
  })
  assert.equal(status, 400)
  assert.match(body.error, /specify "tenant"/)
})

test('an unknown organisation fails like a bad credential', async () => {
  const { status, body } = await login('admin', 'does-not-exist')
  assert.equal(status, 401)
  assert.equal(body.error, 'Invalid credentials')
})
