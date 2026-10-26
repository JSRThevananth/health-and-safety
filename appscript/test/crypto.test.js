import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

function runtime() {
  const rt = createRuntime({
    config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 'a-long-random-secret-value-for-tests' },
  })
  rt.load('Config.gs', 'Crypto.gs')
  return rt
}

test('the same password and salt always produce the same hash', () => {
  const { hashPassword } = runtime().sandbox
  const salt = 'fixedsalt'
  assert.equal(hashPassword('correct horse', salt), hashPassword('correct horse', salt))
})

test('a different salt produces a different hash for the same password', () => {
  const { hashPassword } = runtime().sandbox
  assert.notEqual(hashPassword('same-password', 'saltA'), hashPassword('same-password', 'saltB'))
})

test('salts are unique per call', () => {
  const { generateSalt } = runtime().sandbox
  const salts = new Set()
  for (let i = 0; i < 20; i += 1) salts.add(generateSalt())
  assert.equal(salts.size, 20, 'a repeated salt would let one crack serve two accounts')
})

test('the stored hash never contains the password', () => {
  const { hashPassword } = runtime().sandbox
  const hash = hashPassword('MySecretPassword123', 'somesalt')
  assert.equal(hash.includes('MySecretPassword123'), false)
  assert.match(hash, /^[0-9a-f]+$/, 'hex digest only')
})

test('verifyPassword accepts the right password and rejects near misses', () => {
  const { hashPassword, verifyPassword, generateSalt } = runtime().sandbox
  const salt = generateSalt()
  const hash = hashPassword('DubaiSafe2026!', salt)

  assert.equal(verifyPassword('DubaiSafe2026!', salt, hash), true)
  assert.equal(verifyPassword('DubaiSafe2026', salt, hash), false, 'one character short')
  assert.equal(verifyPassword('dubaisafe2026!', salt, hash), false, 'case matters')
  assert.equal(verifyPassword('', salt, hash), false)
})

test('comparison does not short-circuit on the first differing character', () => {
  const { safeEqual } = runtime().sandbox
  assert.equal(safeEqual('abcdef', 'abcdef'), true)
  assert.equal(safeEqual('abcdef', 'abcdeX'), false)
  assert.equal(safeEqual('abcdef', 'Xbcdef'), false)
  assert.equal(safeEqual('abc', 'abcdef'), false, 'different lengths are not equal')
})

test('a signed token round-trips', () => {
  const { signToken, readToken } = runtime().sandbox
  const exp = new Date(Date.now() + 3600e3).toISOString()
  const token = signToken({ uid: 7, exp })

  const payload = readToken(token)
  assert.equal(payload.uid, 7)
})

test('a tampered token is rejected', () => {
  const { signToken, readToken } = runtime().sandbox
  const exp = new Date(Date.now() + 3600e3).toISOString()
  const token = signToken({ uid: 7, exp })

  // Swap the payload for one claiming to be a different user, keeping the signature.
  const forgedBody = Buffer.from(JSON.stringify({ uid: 1, exp }))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
  const forged = forgedBody + '.' + token.split('.')[1]

  assert.equal(readToken(forged), null, 'a forged identity must not be accepted')
})

test('a token signed with another secret is rejected', () => {
  const a = runtime()
  const other = createRuntime({ config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 'a-different-secret' } })
  other.load('Config.gs', 'Crypto.gs')

  const exp = new Date(Date.now() + 3600e3).toISOString()
  const foreign = other.sandbox.signToken({ uid: 7, exp })

  assert.equal(a.sandbox.readToken(foreign), null)
})

test('an expired token is rejected', () => {
  const { signToken, readToken } = runtime().sandbox
  const token = signToken({ uid: 7, exp: new Date(Date.now() - 1000).toISOString() })
  assert.equal(readToken(token), null)
})

test('malformed tokens are rejected without throwing', () => {
  const { readToken } = runtime().sandbox
  for (const bad of ['', null, undefined, 'nodot', 'a.b.c', '...', 'not-base64.deadbeef']) {
    assert.equal(readToken(bad), null, `should reject: ${String(bad)}`)
  }
})
