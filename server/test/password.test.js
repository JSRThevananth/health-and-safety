import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'

const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

const db = getDb()
const fx = seedTenant(db)
const server = await startServer(createApp)
test.after(() => server.close())

const login = (username, password) =>
  server.request('POST', '/auth/login', { json: { username, password } })

const tokenFor = async (username, password = 'password123') =>
  (await login(username, password)).body.access_token

const admin = await tokenFor('admin')

/** Create a user the way an omni admin does, with an issued temporary password. */
async function createUser(username, temp = 'temporary-1234') {
  await server.request('POST', '/users', {
    token: admin,
    json: {
      username,
      email: `${username}@example.com`,
      full_name: username,
      role: 'inspector',
      password: temp,
      unit_ids: [fx.unitA],
    },
  })
  return tokenFor(username, temp)
}

test('an established account is not asked to change its password', async () => {
  const me = await server.request('GET', '/auth/me', { token: admin })
  assert.equal(me.body.must_change_password, false)
  assert.equal((await server.request('GET', '/units', { token: admin })).status, 200)
})

test('the forced change cannot be satisfied by re-entering the same password', async () => {
  const token = await createUser('repeat.user')
  const { status, body } = await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temporary-1234', new_password: 'temporary-1234' },
  })
  assert.equal(status, 422)
  assert.match(body.error, /must be different/)

  // Still blocked afterwards.
  assert.equal((await server.request('GET', '/units', { token })).status, 403)
})

test('a wrong current password is rejected', async () => {
  const token = await createUser('wrong.current')
  const { status } = await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'not-the-temp', new_password: 'a-good-password-1' },
  })
  assert.equal(status, 401)
})

test('the new password must meet the length rule', async () => {
  const token = await createUser('short.new')
  const { status, body } = await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temporary-1234', new_password: 'short' },
  })
  assert.equal(status, 422)
  assert.equal(body.issues[0].path, 'new_password')
})

test('the old password stops working once changed', async () => {
  const token = await createUser('rotates.pw')
  await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temporary-1234', new_password: 'brand-new-password-9' },
  })

  assert.equal((await login('rotates.pw', 'temporary-1234')).status, 401)
  const fresh = await login('rotates.pw', 'brand-new-password-9')
  assert.equal(fresh.status, 200)
  assert.equal(fresh.body.user.must_change_password, false)
})

test('an admin password reset re-arms the forced change', async () => {
  const token = await createUser('reset.me')
  await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temporary-1234', new_password: 'user-chosen-pw-11' },
  })

  const target = db.prepare('SELECT id FROM users WHERE username = ?').get('reset.me').id
  const reset = await server.request('PATCH', `/users/${target}`, {
    token: admin,
    json: { password: 'admin-reissued-77' },
  })
  assert.equal(reset.status, 200)
  assert.equal(reset.body.must_change_password, true)

  // The admin-issued password authenticates but unlocks nothing until replaced.
  const after = await tokenFor('reset.me', 'admin-reissued-77')
  const blocked = await server.request('GET', '/units', { token: after })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')
})

test('the change is stored as a hash, never in plain text', async () => {
  const token = await createUser('hash.check')
  await server.request('POST', '/auth/change-password', {
    token,
    json: { current_password: 'temporary-1234', new_password: 'plain-text-check-1' },
  })

  const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('hash.check')
  assert.notEqual(row.password_hash, 'plain-text-check-1')
  assert.match(row.password_hash, /^\$2[aby]\$/, 'should be a bcrypt hash')
  assert.ok(bcrypt.compareSync('plain-text-check-1', row.password_hash))
})

test('a user still holding a temporary password cannot reach unit data', async () => {
  const token = await createUser('nosy.user')
  for (const path of ['/units', `/units/${fx.unitA}`, `/units/${fx.unitA}/template`, '/users']) {
    const { status } = await server.request('GET', path, { token })
    assert.equal(status, 403, `${path} should be blocked`)
  }
})
