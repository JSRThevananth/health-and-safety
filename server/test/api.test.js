import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'


const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

seedTenant(getDb())

const server = await startServer(createApp)
test.after(() => server.close())

const login = async (username, password) =>
  (await server.request('POST', '/auth/login', { json: { username, password } })).body.access_token

test('health reports which integrations are live', async () => {
  const { status, body } = await server.request('GET', '/health')
  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
  assert.equal(body.email, 'dry-run')
  assert.equal(body.storage, 'local')
})

test('login rejects a wrong password', async () => {
  const { status, body } = await server.request('POST', '/auth/login', {
    json: { username: 'admin', password: 'nope' },
  })
  assert.equal(status, 401)
  assert.equal(body.error, 'Invalid credentials')
})

test('login rejects an unknown user with the same message', async () => {
  const { status, body } = await server.request('POST', '/auth/login', {
    json: { username: 'ghost', password: 'nope' },
  })
  assert.equal(status, 401)
  assert.equal(body.error, 'Invalid credentials')
})

test('login returns a token and the current user', async () => {
  const { status, body } = await server.request('POST', '/auth/login', {
    json: { username: 'admin', password: 'password123' },
  })
  assert.equal(status, 200)
  assert.ok(body.access_token)
  assert.equal(body.user.username, 'admin')
  assert.equal(body.user.password_hash, undefined, 'password hash must never be serialised')
})

test('protected routes require a valid token', async () => {
  assert.equal((await server.request('GET', '/notifications/log')).status, 401)
  assert.equal((await server.request('GET', '/notifications/log', { token: 'garbage' })).status, 401)
})

test('/auth/me returns the token holder', async () => {
  const token = await login('admin', 'password123')
  const { status, body } = await server.request('GET', '/auth/me', { token })
  assert.equal(status, 200)
  assert.equal(body.username, 'admin')
})

test('invalid payloads return 422 with field detail', async () => {
  const token = await login('admin', 'password123')
  const { status, body } = await server.request('POST', '/notifications/test', {
    token,
    json: { to: 'not-an-email' },
  })
  assert.equal(status, 422)
  assert.equal(body.issues[0].path, 'to')
})

test('email is recorded but not sent while Brevo is disabled', async () => {
  const token = await login('admin', 'password123')
  const { status, body } = await server.request('POST', '/notifications/test', {
    token,
    json: { to: 'someone@example.com' },
  })
  assert.equal(status, 200)
  assert.equal(body.status, 'skipped')
  assert.equal(body.reason, 'brevo disabled')

  const log = await server.request('GET', '/notifications/log', { token })
  assert.equal(log.body[0].recipients, 'someone@example.com')
  assert.equal(log.body[0].status, 'skipped')
})

test('unknown routes return a 404 payload', async () => {
  const token = await login('admin', 'password123')
  const { status, body } = await server.request('GET', '/does-not-exist', { token })
  assert.equal(status, 404)
  assert.match(body.error, /No route for GET/)
})
