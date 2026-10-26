import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAdapter } from '../src/db/adapter.js'

/*
 * Runs the same assertions against both engines. Development uses SQLite and
 * production uses Postgres, so anything that behaves differently between them is a
 * bug that would only appear once deployed - this is where it gets caught instead.
 */
const PG_URL = process.env.TEST_DATABASE_URL
const engines = [
  ['sqlite', { file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-')), 'a.db') }],
  ...(PG_URL ? [['postgres', { url: PG_URL }]] : []),
]

for (const [name, config] of engines) {
  test(`[${name}] insert returns the new id`, async () => {
    const db = await createAdapter(config)
    if (name === 'postgres') await db.exec('TRUNCATE tenants, units, users RESTART IDENTITY CASCADE')

    const { id } = await db.insert(
      'INSERT INTO tenants (name, slug) VALUES (@name, @slug)',
      { name: 'Acme', slug: `acme-${name}` }
    )
    assert.ok(Number.isInteger(id) && id > 0, `expected an id, got ${id}`)

    const row = await db.get('SELECT * FROM tenants WHERE id = @id', { id })
    assert.equal(row.name, 'Acme')
    await db.close()
  })

  test(`[${name}] all() returns rows, get() returns one or undefined`, async () => {
    const db = await createAdapter(config)
    const rows = await db.all('SELECT * FROM tenants')
    assert.ok(Array.isArray(rows))
    const missing = await db.get('SELECT * FROM tenants WHERE id = @id', { id: 999999 })
    assert.equal(missing, undefined, 'a missing row must be undefined on both engines')
    await db.close()
  })

  test(`[${name}] run() reports how many rows changed`, async () => {
    const db = await createAdapter(config)
    const t = await db.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', {
      n: 'Runner', s: `run-${name}`,
    })
    const updated = await db.run('UPDATE tenants SET name = @n WHERE id = @id', {
      n: 'Renamed', id: t.id,
    })
    assert.equal(updated.changes, 1)

    const none = await db.run('UPDATE tenants SET name = @n WHERE id = @id', { n: 'x', id: 999999 })
    assert.equal(none.changes, 0)
    await db.close()
  })

  test(`[${name}] a failed transaction rolls everything back`, async () => {
    const db = await createAdapter(config)
    const before = (await db.all('SELECT * FROM tenants')).length

    await assert.rejects(
      db.tx(async (t) => {
        await t.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', {
          n: 'Doomed', s: `doomed-${name}`,
        })
        throw new Error('something went wrong midway')
      })
    )

    const after = (await db.all('SELECT * FROM tenants')).length
    assert.equal(after, before, 'the partial insert must not survive')
    await db.close()
  })

  test(`[${name}] a successful transaction commits`, async () => {
    const db = await createAdapter(config)
    await db.tx(async (t) => {
      await t.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', {
        n: 'Committed', s: `ok-${name}`,
      })
    })
    const row = await db.get('SELECT * FROM tenants WHERE slug = @s', { s: `ok-${name}` })
    assert.equal(row.name, 'Committed')
    await db.close()
  })

  test(`[${name}] constraints are enforced identically`, async () => {
    const db = await createAdapter(config)
    await db.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', {
      n: 'First', s: `dupe-${name}`,
    })
    await assert.rejects(
      db.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', { n: 'Second', s: `dupe-${name}` }),
      'a duplicate slug must be rejected on both engines'
    )
    await db.close()
  })

  test(`[${name}] a parameter containing @ is not treated as a placeholder`, async () => {
    const db = await createAdapter(config)
    const t = await db.insert('INSERT INTO tenants (name, slug) VALUES (@n, @s)', {
      n: 'Email Co', s: `mail-${name}`,
    })
    await db.insert(
      `INSERT INTO users (tenant_id, username, email, full_name, role, password_hash)
       VALUES (@tenant, @username, @email, @full_name, 'inspector', 'x')`,
      { tenant: t.id, username: `u-${name}`, email: 'someone@example.com', full_name: 'Someone' }
    )
    const row = await db.get('SELECT email FROM users WHERE username = @u', { u: `u-${name}` })
    assert.equal(row.email, 'someone@example.com')
    await db.close()
  })
}

test('both engines were exercised', (t) => {
  /*
   * Skipped rather than failed when Postgres is absent. Apps Script is now the
   * primary build, so a developer without a local Postgres should not see a red
   * suite - but the skip has to be visible, because a silent pass on SQLite alone
   * would hide a dialect difference that only appears in production.
   */
  if (engines.length < 2) {
    t.skip('Postgres not exercised - set TEST_DATABASE_URL to run against both engines')
    return
  }
  assert.equal(engines.length, 2)
})
