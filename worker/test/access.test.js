import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'

test('an omni admin sees every unit; a unit user sees only their own', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)

  const omni = await call('/units', { token: await signIn(call, 'admin', 'admin-password') })
  assert.equal(omni.body.length, 2)

  const inspector = await call('/units', {
    token: await signIn(call, 'lhr.inspector', 'inspector-password'),
  })
  assert.equal(inspector.body.length, 1)
  assert.equal(inspector.body[0].code, 'LHR')
})

test('one unit’s user cannot read another unit, and cannot tell it apart from a missing one', async () => {
  const { db, call } = await createHarness()
  const { unitB } = await seedFixture(db)
  const token = await signIn(call, 'lhr.inspector', 'inspector-password')

  const otherUnit = await call(`/units/${unitB}`, { token })
  const noSuchUnit = await call('/units/9999', { token })

  assert.equal(otherUnit.status, 403)
  assert.equal(noSuchUnit.status, 403)
  assert.equal(otherUnit.body.error, noSuchUnit.body.error)
})

test('one unit’s inspection is invisible to another unit’s inspector', async () => {
  const { db, call } = await createHarness()
  const { unitB } = await seedFixture(db)

  const dxb = await signIn(call, 'dxb.inspector', 'inspector-password')
  const draft = await call('/inspections/draft', { method: 'POST', token: dxb, body: { unit_id: unitB } })
  assert.equal(draft.status, 201)

  const lhr = await signIn(call, 'lhr.inspector', 'inspector-password')
  const peek = await call(`/inspections/${draft.body.id}`, { token: lhr })
  assert.equal(peek.status, 404)

  const list = await call('/inspections', { token: lhr })
  assert.deepEqual(list.body, [])
})

test('an inspector cannot create users or edit the checklist', async () => {
  const { db, call } = await createHarness()
  const { unitA } = await seedFixture(db)
  const token = await signIn(call, 'lhr.inspector', 'inspector-password')

  assert.equal((await call('/users', { token })).status, 403)
  assert.equal((await call(`/units/${unitA}/template/draft`, { method: 'POST', token })).status, 403)
  assert.equal(
    (await call('/units', { method: 'POST', token, body: { name: 'New', code: 'NEW' } })).status,
    403
  )
})

test('a unit admin runs their own unit but cannot create users', async () => {
  const { db, call } = await createHarness()
  const { unitA } = await seedFixture(db)
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  assert.equal((await call(`/units/${unitA}/template/draft`, { method: 'POST', token })).status, 201)
  assert.equal((await call('/users', { token })).status, 403)
})

test('a per-user grant adds one capability without changing the role', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const omni = await signIn(call, 'admin', 'admin-password')

  const inspectorId = (await db.get("SELECT id FROM users WHERE username = 'lhr.inspector'")).id
  const granted = await call(`/users/${inspectorId}/permissions`, {
    method: 'PUT',
    token: omni,
    body: { overrides: { 'user.manage': true } },
  })
  assert.equal(granted.status, 200)
  assert.equal(granted.body.role, 'inspector')

  const token = await signIn(call, 'lhr.inspector', 'inspector-password')
  assert.equal((await call('/users', { token })).status, 200)
})

test('clearing an override falls back to the role preset', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const omni = await signIn(call, 'admin', 'admin-password')
  const inspectorId = (await db.get("SELECT id FROM users WHERE username = 'lhr.inspector'")).id

  await call(`/users/${inspectorId}/permissions`, {
    method: 'PUT',
    token: omni,
    body: { overrides: { 'user.manage': true } },
  })
  await call(`/users/${inspectorId}/permissions`, {
    method: 'PUT',
    token: omni,
    body: { overrides: { 'user.manage': null } },
  })

  const token = await signIn(call, 'lhr.inspector', 'inspector-password')
  assert.equal((await call('/users', { token })).status, 403)
})

test('a user cannot be attached to a unit in another tenant', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const { id: otherTenant } = await db.insert(
    "INSERT INTO tenants (name, slug) VALUES ('Rival Catering', 'rival')"
  )
  const { id: foreignUnit } = await db.insert(
    "INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Rival Unit', 'RIV')",
    { t: otherTenant }
  )

  const res = await call('/users', {
    method: 'POST',
    token,
    body: {
      username: 'sneaky',
      email: 'sneaky@example.com',
      full_name: 'Sneaky Person',
      role: 'inspector',
      password: 'a-long-enough-password-12',
      unit_ids: [foreignUnit],
    },
  })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /Unknown unit/)
})

test('the last active admin cannot be demoted or deactivated', async () => {
  const { db, call } = await createHarness()
  const { unitA } = await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const omniId = (await db.get("SELECT id FROM users WHERE username = 'omni'")).id

  const demote = await call(`/users/${omniId}`, {
    method: 'PATCH',
    token,
    body: { role: 'inspector', unit_ids: [unitA] },
  })
  assert.equal(demote.status, 409)

  const deactivate = await call(`/users/${omniId}`, { method: 'PATCH', token, body: { active: false } })
  assert.equal(deactivate.status, 409)
})

test('a non-admin role must be given at least one unit', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const res = await call('/users', {
    method: 'POST',
    token,
    body: {
      username: 'nowhere',
      email: 'nowhere@example.com',
      full_name: 'Nobody Anywhere',
      role: 'inspector',
      password: 'a-long-enough-password-12',
      unit_ids: [],
    },
  })
  assert.equal(res.status, 422)
})

test('promoting a user to omni admin clears their stale unit assignments', async () => {
  const { db, call } = await createHarness()
  await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')
  const managerId = (await db.get("SELECT id FROM users WHERE username = 'lhr.manager'")).id

  const res = await call(`/users/${managerId}`, { method: 'PATCH', token, body: { role: 'admin' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.unit_ids, null)

  const { n } = await db.get('SELECT COUNT(*) AS n FROM user_units WHERE user_id = @id', { id: managerId })
  assert.equal(n, 0)
})
