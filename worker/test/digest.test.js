import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'
import { installFakeGoogle, restoreFetch } from './fake-google.js'
import { readConfig } from '../src/config.js'
import { createDb } from '../src/db.js'
import { sendOverdueDigest } from '../src/services/digest.js'

afterEach(restoreFetch)

/**
 * The daily chase.
 *
 * The behaviour worth protecting here is what is *not* sent: a digest that
 * arrives every morning saying "nothing outstanding" is one people filter away,
 * taking the useful ones with it.
 */

const BREVO = { BREVO_ENABLED: 'true', BREVO_API_KEY: 'fake', BREVO_SENDER_EMAIL: 'r@example.com' }

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function withActions({ env = {} } = {}) {
  const state = installFakeGoogle()
  const h = await createHarness({ env: { ...BREVO, PUBLIC_URL: 'https://qa.example.workers.dev', ...env } })
  const fixture = await seedFixture(h.db)
  const manager = await signIn(h.call, 'lhr.manager', 'manager-password')

  const ids = {}
  for (const [username, key] of [['lhr.inspector', 'inspector'], ['lhr.manager', 'manager']]) {
    ids[key] = (await h.db.get('SELECT id FROM users WHERE username = @u', { u: username })).id
  }
  // Everyone in the fixture needs an address to be written to.
  await h.db.run("UPDATE users SET email = username || '@example.com'")

  const omni = await signIn(h.call, 'omni', 'admin-password')

  // The omni admin raises anything anywhere; the unit manager is scoped to
  // their own unit, which is the right refusal but the wrong fixture here.
  const raise = async (title, due, owner = null, unitId = fixture.unitA) => {
    const res = await h.call('/capas', {
      method: 'POST',
      token: unitId === fixture.unitA ? manager : omni,
      body: { unit_id: unitId, title, due_date: due, ...(owner ? { owner_id: owner } : {}) },
    })
    assert.equal(res.status, 201, JSON.stringify(res.body))
    return res.body
  }

  return { ...h, ...fixture, state, manager, ids, raise, config: readConfig(h.bindings) }
}

/* ------------------------------------------------------------ what is sent -- */

test('nothing outstanding means nothing sent', async () => {
  const { db, config, state } = await withActions()

  const report = await sendOverdueDigest(db, config)
  assert.equal(report.sent, 0)
  assert.match(report.reason, /nothing due/)
  // Not one message: this is the rule that keeps the digest worth reading.
  assert.equal(state.sentEmails.length, 0)
})

test('an action due next month is not chased today', async () => {
  const { db, config, raise, state } = await withActions()
  await raise('Repaint the loading bay', day(40))

  const report = await sendOverdueDigest(db, config)
  assert.equal(report.sent, 0)
  assert.equal(state.sentEmails.length, 0)
})

test('an owner is written to about their own overdue work', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Fit a door closer', day(-3), ids.inspector)

  const report = await sendOverdueDigest(db, config)
  assert.equal(report.owners, 1)
  assert.ok(report.sent >= 1)

  const theirs = state.sentEmails.find((e) => e.to[0].email === 'lhr.inspector@example.com')
  assert.ok(theirs, 'the owner should have been written to')
  assert.match(theirs.subject, /1 corrective action overdue/)
  assert.match(theirs.htmlContent, /Fit a door closer/)
  assert.match(theirs.htmlContent, /Overdue/)
  // And a way back into the app, or the email is a dead end.
  assert.match(theirs.htmlContent, /https:\/\/qa\.example\.workers\.dev\/app\/actions/)
})

test('due this week is chased too, but says so', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Replace the damaged pallet truck', day(2), ids.inspector)

  await sendOverdueDigest(db, config)
  const theirs = state.sentEmails.find((e) => e.to[0].email === 'lhr.inspector@example.com')
  assert.match(theirs.subject, /due this week/)
  assert.doesNotMatch(theirs.subject, /overdue/)
})

test('an owner hears about their own work and nobody else\'s', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Theirs', day(-1), ids.inspector)
  await raise('The manager\'s own', day(-1), ids.manager)

  await sendOverdueDigest(db, config)
  const inspector = state.sentEmails.find((e) => e.to[0].email === 'lhr.inspector@example.com')
  assert.match(inspector.htmlContent, /Theirs/)
  assert.doesNotMatch(inspector.htmlContent, /The manager&#39;s own|The manager's own/)
})

/* ---------------------------------------------------------------- admins -- */

test('a unit admin gets everything in their unit, assigned or not', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Assigned to the inspector', day(-2), ids.inspector)
  await raise('Nobody has picked this up', day(-5))

  await sendOverdueDigest(db, config)
  const summary = state.sentEmails.find((e) => e.to[0].email === 'lhr.manager@example.com')
  assert.ok(summary)
  assert.match(summary.htmlContent, /Assigned to the inspector/)
  // The unassigned ones are the point of the admin digest: they are what rots.
  assert.match(summary.htmlContent, /Nobody has picked this up/)
  assert.match(summary.htmlContent, /nobody assigned/)
  assert.match(summary.htmlContent, /owner: lhr.inspector/)
})

test('a unit admin is not told about another unit', async () => {
  const { db, config, raise, unitB, state } = await withActions()
  await raise('Dubai problem', day(-2), null, unitB)

  await sendOverdueDigest(db, config)
  const toManager = state.sentEmails.find((e) => e.to[0].email === 'lhr.manager@example.com')
  assert.equal(toManager, undefined, 'LHR\'s manager has no business with a DXB action')

  // The omni admin spans the tenant, so they do hear about it.
  const toOmni = state.sentEmails.find((e) => e.to[0].email === 'omni@example.com')
  assert.match(toOmni.htmlContent, /Dubai problem/)
})

test('a closed action stops the chasing', async () => {
  const { db, config, call, manager, raise, ids, state } = await withActions()
  const capa = await raise('Fit a door closer', day(-3), ids.inspector)
  await call(`/capas/${capa.id}/close`, { method: 'POST', token: manager, body: { note: 'Fitted' } })

  const report = await sendOverdueDigest(db, config)
  assert.equal(report.sent, 0)
  assert.equal(state.sentEmails.length, 0)
})

test('an inactive owner is not written to', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Fit a door closer', day(-3), ids.inspector)
  await db.run('UPDATE users SET active = 0 WHERE id = @id', { id: ids.inspector })

  await sendOverdueDigest(db, config)
  assert.equal(
    state.sentEmails.find((e) => e.to[0].email === 'lhr.inspector@example.com'),
    undefined
  )
})

test('somebody with no email address is skipped, not crashed over', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await db.run("UPDATE users SET email = '' WHERE id = @id", { id: ids.inspector })
  await raise('Fit a door closer', day(-3), ids.inspector)

  const report = await sendOverdueDigest(db, config)
  assert.equal(report.owners, 0)
  // The admins still hear about it, so it is not lost.
  assert.ok(state.sentEmails.length > 0)
})

/* --------------------------------------------------------------- switches -- */

test('the digest can be switched off without switching email off', async () => {
  const { db, bindings, raise, ids, state } = await withActions()
  await raise('Fit a door closer', day(-3), ids.inspector)

  const report = await sendOverdueDigest(db, readConfig({ ...bindings, DIGEST_ENABLED: 'false' }))
  assert.equal(report.sent, 0)
  assert.match(report.reason, /switched off/)
  assert.equal(state.sentEmails.length, 0)
})

test('with Brevo off it reports skipped rather than claiming to have sent', async () => {
  const { db, bindings, raise, ids } = await withActions({ env: { BREVO_ENABLED: 'false' } })
  await raise('Fit a door closer', day(-3), ids.inspector)

  const report = await sendOverdueDigest(db, readConfig({ ...bindings, BREVO_ENABLED: 'false' }))
  assert.equal(report.sent, 0)
  assert.ok(report.skipped > 0, 'the messages were built but not delivered')
})

test('a preview shows who would be written to and sends nothing', async () => {
  const { db, config, raise, ids, state } = await withActions()
  await raise('Fit a door closer', day(-3), ids.inspector)

  const report = await sendOverdueDigest(db, config, { dryRun: true })
  assert.equal(report.sent, 0)
  assert.equal(state.sentEmails.length, 0)
  assert.ok(report.messages.length > 0)
  assert.match(report.messages[0].subject, /overdue|due this week/)
})

/* ----------------------------------------------------------------- limits -- */

test('a flood is capped, most overdue first', async () => {
  const { db, config, raise, call, manager, state } = await withActions()

  // 30 people, each owning one action: more messages than a run will send.
  for (let i = 0; i < 30; i += 1) {
    const { id } = await db.insert(
      `INSERT INTO users (tenant_id, username, email, full_name, role, password_hash, must_change_password)
       VALUES (1, @u, @e, @n, 'inspector', 'x', 0)`,
      { u: `owner${i}`, e: `owner${i}@example.com`, n: `Owner ${i}` }
    )
    await db.run('INSERT INTO user_units (user_id, unit_id) VALUES (@u, 1)', { u: id })
    // The higher the index, the longer overdue.
    await raise(`Action ${i}`, day(-1 - i), id)
  }

  const report = await sendOverdueDigest(db, config)
  assert.ok(report.capped > 0, 'it should say how many it did not get to')
  assert.ok(state.sentEmails.length <= 20, `sent ${state.sentEmails.length}`)
  // Brevo's free tier is 300 a day; a run that tried to send 30 digests plus
  // the day's reports would start losing both.
})

/* ----------------------------------------------------------------- route -- */

test('an admin can preview the digest on demand', async () => {
  const { call, raise, ids, state } = await withActions()
  await raise('Fit a door closer', day(-3), ids.inspector)
  const omni = await signIn(call, 'omni', 'admin-password')

  const res = await call('/notifications/digest', { method: 'POST', token: omni })
  assert.equal(res.status, 200)
  assert.equal(res.body.dry_run, true)
  assert.ok(res.body.messages.length > 0)
  assert.equal(state.sentEmails.length, 0, 'a preview sends nothing')
})

test('previewing the digest is an admin\'s job', async () => {
  const { call } = await withActions()
  const inspector = await signIn(call, 'lhr.inspector', 'inspector-password')

  const res = await call('/notifications/digest', { method: 'POST', token: inspector })
  assert.equal(res.status, 403)
})
