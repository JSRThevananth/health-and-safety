import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'


const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

seedTenant(getDb())

const server = await startServer(createApp)
test.after(() => server.close())

const token = (
  await server.request('POST', '/auth/login', { json: { username: 'admin', password: 'password123' } })
).body.access_token

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

const uploadForm = (buffer, filename, type, entityType = 'record', entityId = 1) => {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type }), filename)
  form.append('entity_type', entityType)
  form.append('entity_id', String(entityId))
  return form
}

test('reports the active storage backend', async () => {
  const { status, body } = await server.request('GET', '/attachments/storage-status', { token })
  assert.equal(status, 200)
  assert.equal(body.backend, 'local')
})

test('rejects a disallowed file type', async () => {
  const { status } = await server.request('POST', '/attachments', {
    token,
    form: uploadForm(Buffer.from('#!/bin/sh\nrm -rf /'), 'evil.sh', 'application/x-sh'),
  })
  assert.equal(status, 415)
})

test('uploads, lists, downloads, and deletes a file', async () => {
  const upload = await server.request('POST', '/attachments', {
    token,
    form: uploadForm(PNG_BYTES, 'evidence.png', 'image/png'),
  })
  assert.equal(upload.status, 201)
  assert.equal(upload.body.storage, 'local')
  assert.equal(upload.body.size_bytes, PNG_BYTES.length)
  assert.equal(upload.body.uploaded_by, 1)

  // The stored name is randomised, so it cannot collide or be guessed from the URL.
  const stored = path.join(tmpDir, 'uploads', upload.body.storage_ref)
  assert.ok(fs.existsSync(stored))
  assert.notEqual(upload.body.storage_ref, 'evidence.png')

  const list = await server.request('GET', '/attachments?entity_type=record&entity_id=1', { token })
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].filename, 'evidence.png')

  const download = await fetch(`${server.base}/attachments/${upload.body.id}/download`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), PNG_BYTES)

  const removed = await server.request('DELETE', `/attachments/${upload.body.id}`, { token })
  assert.equal(removed.status, 204)
  assert.equal(fs.existsSync(stored), false, 'file should be removed from disk, not just the index')

  const after = await server.request('GET', '/attachments?entity_type=record&entity_id=1', { token })
  assert.equal(after.body.length, 0)
})

test('scopes listings to the owning entity', async () => {
  await server.request('POST', '/attachments', {
    token,
    form: uploadForm(PNG_BYTES, 'a.png', 'image/png', 'record', 10),
  })
  await server.request('POST', '/attachments', {
    token,
    form: uploadForm(PNG_BYTES, 'b.png', 'image/png', 'other', 10),
  })

  const record = await server.request('GET', '/attachments?entity_type=record&entity_id=10', { token })
  assert.equal(record.body.length, 1)
  assert.equal(record.body[0].filename, 'a.png')
})

test('uploads require authentication', async () => {
  const { status } = await server.request('POST', '/attachments', {
    form: uploadForm(PNG_BYTES, 'evidence.png', 'image/png'),
  })
  assert.equal(status, 401)
})
