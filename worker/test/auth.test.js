import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/crypto.js'

test('a correct password returns a token and the caller’s own permissions', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  const res = await call('/auth/login', {
    method: 'POST',
    body: { username: 'lhr.inspector', password: 'inspector-password' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.user.role, 'inspector')
  assert.ok(res.body.user.permissions.includes('inspection.create'))
  assert.ok(!res.body.user.permissions.includes('user.manage'))
  // An inspector is scoped to their own units; an omni admin would be null.
  assert.equal(res.body.user.unit_ids.length, 1)
})

test('a wrong password is refused and says nothing about which part was wrong', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  const wrongPassword = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: 'not-it' },
  })
  const noSuchUser = await call('/auth/login', {
    method: 'POST',
    body: { username: 'nobody', password: 'not-it' },
  })

  assert.equal(wrongPassword.status, 401)
  assert.equal(noSuchUser.status, 401)
  assert.equal(wrongPassword.body.error, noSuchUser.body.error)
})

test('an inactive account cannot sign in even with the right password', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  await db.run("UPDATE users SET active = 0 WHERE username = 'lhr.inspector'")

  const res = await call('/auth/login', {
    method: 'POST',
    body: { username: 'lhr.inspector', password: 'inspector-password' },
  })
  assert.equal(res.status, 401)
})

test('repeated failures lock the account out, and the lockout is counted in the database', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  for (let i = 0; i < 10; i += 1) {
    const res = await call('/auth/login', { method: 'POST', body: { username: 'omni', password: 'wrong' } })
    assert.equal(res.status, 401, `attempt ${i + 1} should be refused, not throttled`)
  }

  // The eleventh is throttled - and the right password no longer helps, which is
  // the point: an attacker who finds it on attempt 11 still cannot use it.
  const throttled = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: 'admin-password' },
  })
  assert.equal(throttled.status, 429)

  const { n } = await db.get('SELECT COUNT(*) AS n FROM login_attempts')
  assert.equal(n, 10)
})

test('a successful sign-in clears the failure count', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  for (let i = 0; i < 5; i += 1) {
    await call('/auth/login', { method: 'POST', body: { username: 'omni', password: 'wrong' } })
  }
  await signIn(call, 'omni', 'admin-password')

  const { n } = await db.get("SELECT COUNT(*) AS n FROM login_attempts WHERE username = 'omni'")
  assert.equal(n, 0)
})

test('a forged or expired token reaches nothing', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const real = await signIn(call, 'omni', 'admin-password')

  for (const token of [undefined, 'not-a-token', `${real}x`, real.split('.').slice(0, 2).join('.')]) {
    const res = await call('/units', { token })
    assert.equal(res.status, 401, `token ${String(token).slice(0, 12)} should be refused`)
  }
})

test('a token signed with a different secret is refused', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'omni', 'admin-password')

  // Same app, same database, different signing key.
  const other = await createHarness({ env: { JWT_SECRET: 'a-completely-different-secret-value-here' } })
  const res = await other.call('/units', { token })
  assert.equal(res.status, 401)
})

test('permissions are re-read per request, so a revocation takes effect at once', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  assert.equal((await call('/units', { token })).status, 200)

  await db.run(
    `INSERT INTO user_permissions (user_id, permission, granted)
     SELECT id, 'unit.view', 0 FROM users WHERE username = 'lhr.manager'`
  )

  // The same token, still perfectly valid, now reaches nothing.
  assert.equal((await call('/units', { token })).status, 403)
})

test('a bcrypt hash from the Node build is refused rather than silently accepted', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  await db.run(
    `UPDATE users SET password_hash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
     WHERE username = 'omni'`
  )

  const res = await call('/auth/login', { method: 'POST', body: { username: 'omni', password: 'secret' } })
  assert.equal(res.status, 401)
})

/* ------------------------------------------------------- forced password -- */

async function withTemporaryPassword(db, username) {
  await db.run(
    `UPDATE users SET password_hash = @hash, must_change_password = 1, password_changed_at = NULL
     WHERE username = @u`,
    { hash: await hashPassword('temp-password', 1000), u: username }
  )
}

test('a user holding a temporary password can reach nothing but the change itself', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  await withTemporaryPassword(db, 'lhr.inspector')

  const token = await signIn(call, 'lhr.inspector', 'temp-password')

  const blocked = await call('/units', { token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')

  assert.equal((await call('/auth/me', { token })).status, 200)
})

test('the forced change cannot be satisfied by re-entering the temporary password', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  await withTemporaryPassword(db, 'lhr.inspector')
  const token = await signIn(call, 'lhr.inspector', 'temp-password')

  const res = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: 'temp-password', new_password: 'temp-password' },
  })
  assert.equal(res.status, 422)
})

test('changing the password unlocks the app and the old one stops working', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  await withTemporaryPassword(db, 'lhr.inspector')
  const token = await signIn(call, 'lhr.inspector', 'temp-password')

  const changed = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: 'temp-password', new_password: 'chosen-by-the-user' },
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.body.user.must_change_password, false)

  assert.equal((await call('/units', { token })).status, 200)

  const oldPassword = await call('/auth/login', {
    method: 'POST',
    body: { username: 'lhr.inspector', password: 'temp-password' },
  })
  assert.equal(oldPassword.status, 401)
  await signIn(call, 'lhr.inspector', 'chosen-by-the-user')
})

test('a password shorter than the minimum is refused', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'omni', 'admin-password')

  // One short, derived from the constant rather than typed out: the last time
  // this was a literal, changing the minimum left a test asserting the old one.
  const res = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: 'admin-password', new_password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) },
  })
  assert.equal(res.status, 422)
  assert.match(JSON.stringify(res.body), new RegExp(`${MIN_PASSWORD_LENGTH} characters`))
})

test('a long passphrase is accepted: there is no maximum', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'omni', 'admin-password')

  // Somebody pasting a generated passphrase should never be told it is too
  // long. PBKDF2 hashes the password into a fixed-size key, so length costs
  // nothing to verify.
  const long = 'correct horse battery staple '.repeat(20).trim()
  const res = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: 'admin-password', new_password: long },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))

  // And it actually works as a credential afterwards.
  assert.ok(await signIn(call, 'omni', long))
})

test('exactly the minimum is accepted', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'omni', 'admin-password')

  const res = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: 'admin-password', new_password: 'a'.repeat(MIN_PASSWORD_LENGTH) },
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
})
