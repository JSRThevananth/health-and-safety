import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture } from './helpers.js'
import { releaseAdminAccount } from '../src/services/adminReset.js'

const FIRST_RUN = {
  organisation: 'Gate Gourmet Montreal',
  slug: 'yul',
  admin_email: 'admin@example.com',
  admin_name: 'Omni Administrator',
  unit_name: 'Montreal Catering Unit',
  unit_code: 'YUL',
}

test('a fresh deployment reports that it needs setting up', async () => {
  const { call } = await createHarness()
  assert.equal((await call('/setup/status')).body.needs_setup, true)
})

test('first-run setup creates the organisation, the unit and the admin', async () => {
  const { call } = await createHarness()
  const res = await call('/setup', { method: 'POST', body: FIRST_RUN })

  assert.equal(res.status, 201)
  assert.equal(res.body.admin.username, 'omni')
  assert.ok(res.body.admin.temporary_password.length >= 18)
  // The checklist is a second request, because the two together exceed the
  // 10ms of CPU a Worker gets on the free plan.
  assert.equal(res.body.next_step, 'checklist')

  // The account works, and insists on a password of the user's own.
  const login = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: res.body.admin.temporary_password },
  })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.must_change_password, true)

  const blocked = await call('/units', { token: login.body.access_token })
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')
})

test('setup cannot be run twice', async () => {
  const { call } = await createHarness()
  await call('/setup', { method: 'POST', body: FIRST_RUN })

  const again = await call('/setup', { method: 'POST', body: { ...FIRST_RUN, slug: 'other' } })
  assert.equal(again.status, 409)
  assert.equal((await call('/setup/status')).body.needs_setup, false)
})

test('setup is refused on a deployment that already has data', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  const res = await call('/setup', { method: 'POST', body: FIRST_RUN })
  assert.equal(res.status, 409)
})

test('the caller cannot choose the first password', async () => {
  const { call } = await createHarness()
  const res = await call('/setup', {
    method: 'POST',
    body: { ...FIRST_RUN, admin_password: 'password123' },
  })
  assert.equal(res.status, 201)

  const chosen = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: 'password123' },
  })
  assert.equal(chosen.status, 401)
})

test('setup is refused on a deployment with no signing secret', async () => {
  const { call } = await createHarness({ env: { JWT_SECRET: '' } })

  // Setup can only be run once. A deployment that is not finished must not be
  // able to spend that one chance and leave an account nobody can sign in to.
  const res = await call('/setup', { method: 'POST', body: FIRST_RUN })
  assert.equal(res.status, 503)
  assert.equal((await call('/setup/status')).status, 503)
})

/* --------------------------------------------- the interrupted-setup path -- */

test('the checklist is installed by its own request, and is live immediately', async () => {
  const { call } = await createHarness()
  const created = await call('/setup', { method: 'POST', body: FIRST_RUN })
  const temporary = created.body.admin.temporary_password

  const res = await call('/setup/checklist', { method: 'POST' })
  assert.equal(res.status, 200)
  assert.equal(res.body.checklist.items, 303)

  // End to end on the account setup just made: sign in, choose a password, and
  // start an inspection against the checklist that was installed.
  const login = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: temporary },
  })
  assert.equal(login.status, 200)

  const token = login.body.access_token
  const changed = await call('/auth/change-password', {
    method: 'POST',
    token,
    body: { current_password: temporary, new_password: 'a-password-of-my-own' },
  })
  assert.equal(changed.status, 200)

  const draft = await call('/inspections/draft', {
    method: 'POST',
    token,
    body: { unit_id: res.body.unit.id },
  })
  assert.equal(draft.status, 201)
  assert.equal(draft.body.summary_counts.total, 303)
})

test('setup finishes an interrupted run rather than refusing it', async () => {
  const { db, call } = await createHarness()

  // Exactly the wreckage a killed setup leaves: an organisation and a unit,
  // and no administrator. This is what happened in production.
  const { id: tenantId } = await db.insert(
    "INSERT INTO tenants (name, slug) VALUES ('Gate Gourmet Montreal', 'yul')"
  )
  await db.insert("INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Montreal', 'YUL')", {
    t: tenantId,
  })

  const status = await call('/setup/status')
  assert.equal(status.body.needs_setup, true, 'no admin means setup is not done')

  const res = await call('/setup', { method: 'POST', body: FIRST_RUN })
  assert.equal(res.status, 201, 'it should finish the job, not refuse it')
  assert.ok(res.body.admin.temporary_password)

  // And it reuses what was already there instead of creating a second of each.
  const { n: tenants } = await db.get('SELECT COUNT(*) AS n FROM tenants')
  const { n: units } = await db.get('SELECT COUNT(*) AS n FROM units')
  assert.equal(tenants, 1)
  assert.equal(units, 1)
})

test('status reports a missing checklist so the page can offer to finish it', async () => {
  const { call } = await createHarness()
  await call('/setup', { method: 'POST', body: FIRST_RUN })

  const before = await call('/setup/status')
  assert.deepEqual(before.body, { needs_setup: false, needs_checklist: true })

  await call('/setup/checklist', { method: 'POST' })

  const after = await call('/setup/status')
  assert.deepEqual(after.body, { needs_setup: false, needs_checklist: false })
})

test('asking again for a checklist that exists succeeds without reinstalling it', async () => {
  const { db, call } = await createHarness()
  await call('/setup', { method: 'POST', body: FIRST_RUN })
  await call('/setup/checklist', { method: 'POST' })

  const again = await call('/setup/checklist', { method: 'POST' })
  assert.equal(again.status, 200, 'a complete deployment is not an error')
  assert.equal(again.body.already_installed, true)
  assert.equal(again.body.checklist.items, 303)

  // And nothing was duplicated or republished.
  const { n: items } = await db.get('SELECT COUNT(*) AS n FROM library_items')
  const { n: published } = await db.get(
    "SELECT COUNT(*) AS n FROM unit_templates WHERE status = 'published'"
  )
  assert.equal(items, 303)
  assert.equal(published, 1)
})

test('a reissued admin lands on a complete deployment, not a warning', async () => {
  const { db, call } = await createHarness()
  await call('/setup', { method: 'POST', body: FIRST_RUN })
  await call('/setup/checklist', { method: 'POST' })

  // What losing the temporary password looks like: the account is released so
  // a new one can be issued. Everything else stays.
  const admin = await db.get("SELECT id FROM users WHERE role = 'omni_admin'")
  const released = await releaseAdminAccount(db, admin.id)
  assert.equal(released.ok, true)

  const status = await call('/setup/status')
  assert.equal(status.body.needs_setup, true)

  const again = await call('/setup', { method: 'POST', body: FIRST_RUN })
  assert.equal(again.status, 201)
  assert.ok(again.body.admin.temporary_password)

  const checklist = await call('/setup/checklist', { method: 'POST' })
  assert.equal(checklist.status, 200, 'the existing checklist must not read as a failure')

  // The new password works, and the unit still has its 303 points.
  const login = await call('/auth/login', {
    method: 'POST',
    body: { username: 'omni', password: again.body.admin.temporary_password },
  })
  assert.equal(login.status, 200)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM library_items')
  assert.equal(n, 303)
})

test('the checklist step refuses before an organisation exists', async () => {
  const { call } = await createHarness()
  const res = await call('/setup/checklist', { method: 'POST' })
  assert.equal(res.status, 409)
})

test('an admin who has run inspections is not released', async () => {
  const { db } = await createHarness()
  const fixture = await seedFixture(db)

  // seedFixture's omni admin has created the published templates; give them an
  // inspection too, which is the thing that must block removal.
  await db.insert(
    `INSERT INTO inspections (unit_id, template_id, inspector_id)
     SELECT @u, id, @i FROM unit_templates WHERE unit_id = @u AND status = 'published'`,
    { u: fixture.unitA, i: fixture.omni }
  )

  const released = await releaseAdminAccount(db, fixture.omni)
  assert.ok(released.error, 'removing an admin with inspections must be refused')
  assert.match(released.error, /carried out inspections/)

  const still = await db.get('SELECT id FROM users WHERE id = @id', { id: fixture.omni })
  assert.ok(still, 'the account must still be there')
})
