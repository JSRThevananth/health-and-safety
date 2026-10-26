import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'
import { readConfig } from '../src/config.js'
import { purgePhotos, pruneLoginAttempts, MAX_PHOTOS_PER_RUN } from '../src/services/retention.js'

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

async function uploadAgainst(call, token, inspectionId) {
  const form = new FormData()
  form.set('file', new File([PNG], 'finding.png', { type: 'image/png' }))
  form.set('entity_type', 'inspection')
  form.set('entity_id', String(inspectionId))
  return (await call('/attachments', { method: 'POST', token, form })).body
}

async function withPhoto(ageDays) {
  const h = await createHarness({ withR2: true })
  const fixture = await seedFixture(h.db)
  const token = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body

  const attachment = await uploadAgainst(h.call, token, draft.id)
  const created = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  await h.db.run('UPDATE attachments SET created_at = @at WHERE id = @id', {
    at: created,
    id: attachment.id,
  })

  return { ...h, ...fixture, token, draft, attachment }
}

test('a photo past the retention window is deleted but its row survives as a tombstone', async () => {
  // The default window is 14 days.
  const { db, r2, bindings, attachment } = await withPhoto(20)
  const config = readConfig(bindings)

  const report = await purgePhotos(bindings, config, db)
  assert.equal(report.examined, 1)
  assert.equal(report.purged, 1)
  assert.equal(r2.objects.size, 0)

  const row = await db.get('SELECT * FROM attachments WHERE id = @id', { id: attachment.id })
  assert.ok(row, 'the row must survive so an auditor sees a reason, not a missing file')
  assert.ok(row.purged_at)
  assert.match(row.purge_policy, /14 days/)
})

test('a photo inside the window is left alone', async () => {
  const { db, r2, bindings } = await withPhoto(3)
  const report = await purgePhotos(bindings, readConfig(bindings), db)

  assert.equal(report.examined, 0)
  assert.equal(r2.objects.size, 1)
})

test('a dry run reports what it would remove and removes nothing', async () => {
  const { db, r2, bindings } = await withPhoto(20)
  const report = await purgePhotos(bindings, readConfig(bindings), db, { dryRun: true })

  assert.equal(report.examined, 1)
  assert.equal(report.purged, 0)
  assert.equal(r2.objects.size, 1)
})

test('each tenant’s own window is applied to its own evidence', async () => {
  const { db, r2, bindings } = await withPhoto(20)
  await db.run('UPDATE tenants SET photo_retention_days = 60')

  const report = await purgePhotos(bindings, readConfig(bindings), db)
  assert.equal(report.examined, 0)
  assert.equal(r2.objects.size, 1)
})

test('an already purged photo is not purged twice', async () => {
  const { db, bindings } = await withPhoto(20)
  await purgePhotos(bindings, readConfig(bindings), db)

  const second = await purgePhotos(bindings, readConfig(bindings), db)
  assert.equal(second.examined, 0)
})

test('ratings and the inspection record are never touched by the purge', async () => {
  const { db, call, token, draft, bindings } = await withPhoto(20)
  const item = draft.sections[0].items[0]
  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })

  await purgePhotos(bindings, readConfig(bindings), db)

  const reread = await call(`/inspections/${draft.id}`, { token })
  assert.equal(reread.body.summary_counts.critical, 1)
  assert.equal(reread.body.sections[0].items[0].note, 'Fire door wedged open')
})

test('stale sign-in attempts are pruned, recent ones kept', async () => {
  const { db } = await createHarness()
  await db.run("INSERT INTO login_attempts (username, ip, created_at) VALUES ('a', '', '2020-01-01T00:00:00Z')")
  await db.run('INSERT INTO login_attempts (username, ip, created_at) VALUES (@u, @ip, @at)', {
    u: 'b',
    ip: '',
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  })

  const { deleted } = await pruneLoginAttempts(db, 15)
  assert.equal(deleted, 1)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM login_attempts')
  assert.equal(n, 1)
})

test('a backlog larger than one run is capped, and the remainder reported', async () => {
  const { db, r2, bindings } = await withPhoto(20)
  const config = readConfig(bindings)

  // 60 more old photos on the same inspection: more than one run may take.
  const { entity_id } = await db.get('SELECT entity_id FROM attachments LIMIT 1')
  const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  for (let i = 0; i < 60; i += 1) {
    await r2.put(`key-${i}`, new Uint8Array([1, 2, 3]))
    await db.insert(
      `INSERT INTO attachments (entity_type, entity_id, filename, mime_type, size_bytes,
                                storage, storage_ref, uploaded_by, created_at)
       VALUES ('inspection', @e, @name, 'image/jpeg', 3, 'r2', @ref, NULL, @at)`,
      { e: entity_id, name: `photo-${i}.jpg`, ref: `key-${i}`, at: old }
    )
  }

  const first = await purgePhotos(bindings, config, db)
  // Bounded by the subrequest budget, not by how much work there is.
  assert.equal(first.purged, MAX_PHOTOS_PER_RUN)
  assert.ok(first.remaining > 0, 'it should say a backlog remains')

  const second = await purgePhotos(bindings, config, db)
  assert.ok(second.purged > 0, 'the next run should carry on where it stopped')

  // And nothing is purged twice.
  const { n } = await db.get('SELECT COUNT(*) AS n FROM attachments WHERE purged_at IS NOT NULL')
  assert.equal(n, first.purged + second.purged)
})
