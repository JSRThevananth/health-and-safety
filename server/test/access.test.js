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

const tokenFor = async (username) =>
  (await server.request('POST', '/auth/login', { json: { username, password: 'password123' } }))
    .body.access_token

const admin = await tokenFor('admin')
const manager = await tokenFor('manager')
const inspector = await tokenFor('inspector')
const viewer = await tokenFor('viewer')

test('login reports the caller unit scope and permissions', async () => {
  const { body } = await server.request('POST', '/auth/login', {
    json: { username: 'manager', password: 'password123' },
  })
  assert.equal(body.user.role, 'unit_admin')
  assert.deepEqual(body.user.unit_ids, [fx.unitA])
  assert.ok(body.user.permissions.includes('template.edit'))
  assert.equal(body.user.permissions.includes('user.manage'), false)
})

test('admin is tenant-wide, signalled by a null unit scope', async () => {
  const { body } = await server.request('GET', '/auth/me', { token: admin })
  assert.equal(body.unit_ids, null)
})

test('admin sees every unit; a limited user sees only their own', async () => {
  const all = await server.request('GET', '/units', { token: admin })
  assert.equal(all.body.length, 2)

  const scoped = await server.request('GET', '/units', { token: manager })
  assert.equal(scoped.body.length, 1)
  assert.equal(scoped.body[0].id, fx.unitA)
})

test('a limited user cannot read a unit outside their scope', async () => {
  const mine = await server.request('GET', `/units/${fx.unitA}`, { token: manager })
  assert.equal(mine.status, 200)

  const theirs = await server.request('GET', `/units/${fx.unitB}`, { token: manager })
  assert.equal(theirs.status, 403)
  assert.equal(theirs.body.error, 'No access to this unit')
})

test('out-of-scope and non-existent units are indistinguishable', async () => {
  // Otherwise a limited user could enumerate the tenant's units by status code.
  const outOfScope = await server.request('GET', `/units/${fx.unitB}`, { token: manager })
  const nonExistent = await server.request('GET', '/units/999999', { token: manager })
  assert.equal(outOfScope.status, nonExistent.status)
  assert.deepEqual(outOfScope.body, nonExistent.body)
})

test('only admins may create units or manage users', async () => {
  for (const token of [manager, inspector, viewer]) {
    const created = await server.request('POST', '/units', {
      token,
      json: { name: 'New Unit', code: 'NEW' },
    })
    assert.equal(created.status, 403)
    assert.match(created.body.error, /Missing permission: unit\.manage/)

    assert.equal((await server.request('GET', '/users', { token })).status, 403)
  }

  const ok = await server.request('POST', '/units', {
    token: admin,
    json: { name: 'Singapore', code: 'SIN' },
  })
  assert.equal(ok.status, 201)
})

test('role presets grant the expected capabilities', async () => {
  const inspectorMe = await server.request('GET', '/auth/me', { token: inspector })
  assert.ok(inspectorMe.body.permissions.includes('inspection.create'))
  // An inspector must not sign off or close their own findings.
  assert.equal(inspectorMe.body.permissions.includes('inspection.sign'), false)
  assert.equal(inspectorMe.body.permissions.includes('capa.close'), false)

  const viewerMe = await server.request('GET', '/auth/me', { token: viewer })
  assert.ok(viewerMe.body.permissions.every((p) => p.endsWith('.view')))
})
