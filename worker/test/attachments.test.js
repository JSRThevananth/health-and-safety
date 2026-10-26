import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'

/** A one-pixel PNG, so the bytes are a real image rather than a string. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

const upload = (bytes, { name = 'finding.png', type = 'image/png', entity = 1 } = {}) => {
  const form = new FormData()
  form.set('file', new File([bytes], name, { type }))
  form.set('entity_type', 'inspection')
  form.set('entity_id', String(entity))
  return form
}

async function withR2() {
  const h = await createHarness({ withR2: true })
  await seedFixture(h.db)
  return { ...h, token: await signIn(h.call, 'lhr.inspector', 'inspector-password') }
}

test('a photo is stored in R2 and the row points at it', async () => {
  const { call, token, r2 } = await withR2()

  const res = await call('/attachments', { method: 'POST', token, form: upload(PNG) })
  assert.equal(res.status, 201)
  assert.equal(res.body.storage, 'r2')
  assert.equal(res.body.mime_type, 'image/png')
  assert.equal(res.body.size_bytes, PNG.byteLength)
  assert.equal(r2.objects.size, 1)
  assert.ok(r2.objects.has(res.body.storage_ref))
})

test('the stored key cannot be guessed from the filename', async () => {
  const { call, token } = await withR2()
  const res = await call('/attachments', { method: 'POST', token, form: upload(PNG, { name: 'photo.png' }) })

  // Two uploads of the same name must not collide, and the key must not be the
  // name alone - otherwise one unit's upload overwrites another's.
  const second = await call('/attachments', { method: 'POST', token, form: upload(PNG, { name: 'photo.png' }) })
  assert.notEqual(res.body.storage_ref, second.body.storage_ref)
  assert.notEqual(res.body.storage_ref, 'photo.png')
})

test('a download returns the bytes that went in', async () => {
  const { call, token } = await withR2()
  const created = await call('/attachments', { method: 'POST', token, form: upload(PNG) })

  const res = await call(`/attachments/${created.body.id}/download`, { token })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.match(res.headers.get('content-disposition'), /finding\.png/)
})

test('anything not a photo or document is refused', async () => {
  const { call, token } = await withR2()

  const res = await call('/attachments', {
    method: 'POST',
    token,
    form: upload(new Uint8Array([1, 2, 3]), { name: 'payload.svg', type: 'image/svg+xml' }),
  })
  assert.equal(res.status, 415)
})

test('an empty upload is refused rather than stored as a zero-byte file', async () => {
  const { call, token, r2 } = await withR2()

  const res = await call('/attachments', { method: 'POST', token, form: upload(new Uint8Array()) })
  assert.equal(res.status, 422)
  assert.equal(r2.objects.size, 0)
})

test('deleting an attachment removes the object as well as the row', async () => {
  const { call, token, r2, db } = await withR2()
  const created = await call('/attachments', { method: 'POST', token, form: upload(PNG) })

  assert.equal((await call(`/attachments/${created.body.id}`, { method: 'DELETE', token })).status, 204)
  assert.equal(r2.objects.size, 0)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM attachments')
  assert.equal(n, 0)
})

test('with no storage configured an upload fails loudly instead of silently dropping evidence', async () => {
  const h = await createHarness() // STORAGE_BACKEND defaults to "none"
  await seedFixture(h.db)
  const token = await signIn(h.call, 'lhr.inspector', 'inspector-password')

  const res = await h.call('/attachments', { method: 'POST', token, form: upload(PNG) })
  assert.equal(res.status, 500)

  const status = await h.call('/attachments/storage-status', { token })
  assert.equal(status.body.backend, 'none')
})

test('a purged photo reports when and why, rather than appearing broken', async () => {
  const { call, token, db } = await withR2()
  const created = await call('/attachments', { method: 'POST', token, form: upload(PNG) })

  await db.run(
    `UPDATE attachments SET purged_at = '2026-02-01T03:10:00Z', purge_policy = 'photo retention: 14 days'
     WHERE id = @id`,
    { id: created.body.id }
  )

  const res = await call(`/attachments/${created.body.id}/download`, { token })
  assert.equal(res.status, 410)
  assert.match(res.body.error, /purged on 2026-02-01/)
  assert.equal(res.body.purge_policy, 'photo retention: 14 days')
})

test('uploading needs a signed-in user', async () => {
  const { call } = await withR2()
  const res = await call('/attachments', { method: 'POST', form: upload(PNG) })
  assert.equal(res.status, 401)
})
