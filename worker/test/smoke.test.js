import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'

test('health reports a reachable database and a complete configuration', async () => {
  const { call } = await createHarness()
  const res = await call('/health')
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'ok')
  assert.equal(res.body.database, 'ok')
  assert.deepEqual(res.body.problems, [])
})

test('health refuses to look healthy without a signing secret', async () => {
  const { call } = await createHarness({ env: { JWT_SECRET: '' } })
  const res = await call('/health')
  assert.equal(res.status, 503)
  assert.equal(res.body.status, 'degraded')
  assert.match(res.body.problems.join(' '), /JWT_SECRET/)
})

test('a deployment with no signing secret issues no tokens at all', async () => {
  const { db, call } = await createHarness({ env: { JWT_SECRET: '' } })
  await seedFixture(db)
  const res = await call('/auth/login', { method: 'POST', body: { username: 'omni', password: 'admin-password' } })
  assert.equal(res.status, 503)
})

test('the seeded fixture publishes the full checklist for each unit', async () => {
  const { db, call } = await createHarness()
  const { unitA } = await seedFixture(db)
  const token = await signIn(call, 'omni', 'admin-password')

  const res = await call(`/units/${unitA}/template`, { token })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'published')
  assert.equal(res.body.version, 1)
  assert.equal(res.body.stats.items_effective, 303)
  assert.equal(res.body.stats.sections_total, 16)
})

test('an unknown route answers in JSON, not HTML', async () => {
  const { call } = await createHarness()
  const res = await call('/nope')
  assert.equal(res.status, 404)
  assert.match(res.body.error, /No route for GET/)
})
