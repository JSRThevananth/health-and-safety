import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb, toNumbered, now, MAX_BOUND_PARAMS } from '../src/db.js'
import { createTestD1 } from './d1.js'
import { createHarness, seedFixture, signIn } from './helpers.js'

/**
 * The constraints that are specific to D1.
 *
 * These are the things that cannot go wrong on SQLite or Postgres and will go
 * wrong in production: the 100-parameter cap, and the absence of an interactive
 * transaction.
 */

test('named parameters become numbered ones, and a repeated name binds one value', () => {
  const { text, values } = toNumbered(
    'SELECT * FROM t WHERE a = @x AND b = @y AND c = @x',
    { x: 1, y: 'two' }
  )
  assert.equal(text, 'SELECT * FROM t WHERE a = ?1 AND b = ?2 AND c = ?1')
  assert.deepEqual(values, [1, 'two'])
})

test('an @ inside a string literal is not a parameter', () => {
  const { text, values } = toNumbered("SELECT * FROM t WHERE email = 'a@b.com' AND id = @id", { id: 7 })
  assert.equal(text, "SELECT * FROM t WHERE email = 'a@b.com' AND id = ?1")
  assert.deepEqual(values, [7])
})

test('a query that names a parameter nobody supplied fails where the cause is obvious', () => {
  assert.throws(() => toNumbered('SELECT * FROM t WHERE id = @id', {}), /@id/)
})

test('undefined is stored as null rather than failing with an unhelpful binding error', async () => {
  const db = createDb(createTestD1())
  const { id: tenantId } = await db.insert("INSERT INTO tenants (name, slug) VALUES ('T', 't')")
  await db.insert(
    `INSERT INTO users (tenant_id, username, password_hash, password_changed_at)
     VALUES (@t, 'u', 'x', '2026-01-01T00:00:00Z')`,
    { t: tenantId }
  )

  // D1 rejects an undefined binding with a message that names no column, so the
  // data layer converts it rather than letting that error reach a caller.
  await db.run('UPDATE users SET password_changed_at = @at WHERE username = @u', {
    at: undefined,
    u: 'u',
  })
  assert.equal((await db.get("SELECT password_changed_at AS at FROM users WHERE username = 'u'")).at, null)
})

test('a bulk insert stays under D1’s parameter cap however many rows it is given', async () => {
  const db = createDb(createTestD1())
  const { id: tenantId } = await db.insert("INSERT INTO tenants (name, slug) VALUES ('T', 't')")
  const { id: sectionId } = await db.insert(
    "INSERT INTO library_sections (tenant_id, code, title) VALUES (@t, 'S01', 'Section')",
    { t: tenantId }
  )
  const { id: groupId } = await db.insert(
    "INSERT INTO library_groups (section_id, code) VALUES (@s, 'G01')",
    { s: sectionId }
  )

  const rows = Array.from({ length: 250 }, (_, i) => ({
    group_id: groupId,
    code: `I${i}`,
    text: `Item ${i}`,
    sort_order: i,
  }))
  const statements = db.bulkInsert('library_items', ['group_id', 'code', 'text', 'sort_order'], rows)

  // 4 columns, so 25 rows per statement at the 100-parameter cap.
  assert.equal(statements.length, 10)
  for (const statement of statements) {
    assert.ok(statement.params.length <= MAX_BOUND_PARAMS, 'a statement exceeded the cap')
  }

  await db.batch(statements)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM library_items')
  assert.equal(n, 250)
})

test('the shim refuses an over-bound statement, exactly as D1 would', async () => {
  const d1 = createTestD1()
  const params = Array.from({ length: 101 }, (_, i) => i)
  const placeholders = params.map(() => '?').join(',')
  assert.throws(
    () => d1.prepare(`SELECT ${placeholders}`).bind(...params),
    /too many SQL variables/
  )
})

test('a batch is atomic: one bad statement rolls the whole thing back', async () => {
  const db = createDb(createTestD1())
  const { id: tenantId } = await db.insert("INSERT INTO tenants (name, slug) VALUES ('T', 't')")

  await assert.rejects(
    db.batch([
      db.stmt("INSERT INTO units (tenant_id, name, code) VALUES (@t, 'One', 'ONE')", { t: tenantId }),
      // A tenant that does not exist: the foreign key rejects it.
      db.stmt("INSERT INTO units (tenant_id, name, code) VALUES (99999, 'Two', 'TWO')"),
    ])
  )

  const { n } = await db.get('SELECT COUNT(*) AS n FROM units')
  assert.equal(n, 0, 'the first insert should have been rolled back with the second')
})

test('an id list is inlined, so a long list is not bound as parameters', async () => {
  const db = createDb(createTestD1())
  assert.equal(db.idList([1, 2, 3]), '1,2,3')
  assert.equal(db.idList([]), 'NULL')
  // Anything that is not an integer never reaches the query.
  assert.throws(() => db.idList(['1); DROP TABLE users; --']), /Not an id/)
})

test('a user with more than 100 units still gets a working unit list', async () => {
  const { db, call } = await createHarness()
  const { tenantId } = await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const { id: userId } = (
    await call('/users', {
      method: 'POST',
      token,
      body: {
        username: 'regional',
        email: 'regional@example.com',
        full_name: 'Regional Manager',
        role: 'viewer',
        password: 'a-long-enough-password-12',
        unit_ids: [(await db.get("SELECT id FROM units WHERE code = 'LHR'")).id],
      },
    })
  ).body

  // 120 more units, all assigned: this is the query that would break if the ids
  // were bound rather than inlined.
  for (let i = 0; i < 120; i += 1) {
    const { id } = await db.insert(
      "INSERT INTO units (tenant_id, name, code) VALUES (@t, @name, @code)",
      { t: tenantId, name: `Unit ${i}`, code: `U${i}` }
    )
    await db.run('INSERT INTO user_units (user_id, unit_id) VALUES (@u, @unit)', { u: userId, unit: id })
  }

  // Borrow the omni admin's hash and clear the forced change, so the sign-in below
  // tests the unit list rather than the first-password screen.
  await db.run(
    `UPDATE users
     SET password_hash = (SELECT password_hash FROM users WHERE username = 'admin'),
         must_change_password = 0
     WHERE id = @id`,
    { id: userId }
  )
  const viewer = await signIn(call, 'regional', 'admin-password')
  const res = await call('/units', { token: viewer })

  assert.equal(res.status, 200)
  assert.equal(res.body.length, 121)
})

test('a 303-item checklist is seeded in one atomic batch', async () => {
  const { db, call } = await createHarness()
  const { tenantId } = await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const { id: unitId } = await db.insert(
    "INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Fresh Unit', 'FRSH')",
    { t: tenantId }
  )

  const draft = await call(`/units/${unitId}/template/draft`, { method: 'POST', token })
  assert.equal(draft.status, 201)
  assert.equal(draft.body.stats.items_total, 303)

  const { n } = await db.get('SELECT COUNT(*) AS n FROM unit_template_items WHERE template_id = @t', {
    t: draft.body.id,
  })
  assert.equal(n, 303)
})

test('a failed seed leaves no half-built draft behind', async () => {
  const { db, call } = await createHarness()
  const { tenantId } = await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const { id: unitId } = await db.insert(
    "INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Doomed Unit', 'DOOM')",
    { t: tenantId }
  )

  // Break the child insert the way a real D1 failure would: the bulk insert runs
  // against a table that no longer accepts the rows.
  await db.raw.exec('DROP TABLE unit_template_items')

  const res = await call(`/units/${unitId}/template/draft`, { method: 'POST', token })
  assert.equal(res.status, 500)

  const { n } = await db.get('SELECT COUNT(*) AS n FROM unit_templates WHERE unit_id = @u', { u: unitId })
  assert.equal(n, 0, 'the parent template row should have been cleaned up')
})

test('timestamps written by a column default match the ones the app writes', async () => {
  const db = createDb(createTestD1())
  const { id: tenantId } = await db.insert("INSERT INTO tenants (name, slug) VALUES ('T', 't')")
  const { created_at: byDefault } = await db.get('SELECT created_at FROM tenants WHERE id = @id', {
    id: tenantId,
  })

  // "2026-10-09T23:21:47Z", not "2026-10-09 23:21:47". The two sort differently
  // against each other, and retention windows depend on that comparison.
  assert.match(byDefault, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  // Both are UTC to the second, so a row written in the same second ties rather
  // than sorting before - which is the point: they are comparable at all.
  assert.ok(byDefault <= now(), 'a default timestamp must compare against an app-written one')
})
