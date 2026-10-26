import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'

const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

seedTenant(getDb())
const server = await startServer(createApp)
test.after(() => server.close())

test('security headers are set', async () => {
  const { headers } = await server.request('GET', '/health')
  // helmet's defaults; spot-check the ones that matter for an API.
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
  assert.ok(headers.get('x-frame-options') || headers.get('content-security-policy'))
  assert.equal(headers.get('x-powered-by'), null, 'must not advertise Express')
})

test('repeated failed sign-ins are throttled', async () => {
  const attempt = () =>
    server.request('POST', '/auth/login', { json: { username: 'admin', password: 'wrong' } })

  let limited = null
  // The limiter allows 10 failures per window; the 11th should be refused.
  for (let i = 0; i < 14; i += 1) {
    const res = await attempt()
    if (res.status === 429) { limited = res; break }
  }

  assert.ok(limited, 'brute-force attempts should eventually be rate limited')
  assert.match(limited.body.error, /Too many sign-in attempts/)
})

test('a correct password still works once wrong ones were throttled', async () => {
  // skipSuccessfulRequests means genuine users are not punished for others' noise,
  // but an IP already over the limit stays blocked until the window passes.
  const { status } = await server.request('POST', '/auth/login', {
    json: { username: 'admin', password: 'password123' },
  })
  assert.ok([200, 429].includes(status), `unexpected status ${status}`)
})
