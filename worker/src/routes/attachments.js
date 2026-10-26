import { Hono } from 'hono'
import { z } from 'zod'
import { now } from '../db.js'
import { validateQuery } from '../middleware/validate.js'
import { fail } from '../middleware/errors.js'
import {
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  storeFile,
  readFile,
  deleteFile,
  storageBackend,
} from '../services/storage.js'

const attachments = new Hono()

// entity_type is a free-form owner tag (e.g. 'inspection_item'). Domain routes are
// responsible for checking the referenced row actually exists.
const targetSchema = z.object({
  entity_type: z.string().min(1).max(40),
  entity_id: z.coerce.number().int().positive(),
})

attachments.get('/', validateQuery(targetSchema), async (c) => {
  const { entity_type, entity_id } = c.get('query')
  return c.json(
    await c.get('db').all(
      `SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, storage,
              web_view_link, uploaded_by, created_at, purged_at, purge_policy
       FROM attachments WHERE entity_type = @t AND entity_id = @i ORDER BY created_at DESC`,
      { t: entity_type, i: entity_id }
    )
  )
})

attachments.post('/', async (c) => {
  const db = c.get('db')
  const config = c.get('config')

  let form
  try {
    form = await c.req.formData()
  } catch {
    throw fail(400, 'Expected a multipart form upload with a "file" field')
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') throw fail(422, 'No file uploaded (field name: "file")')

  const target = targetSchema.safeParse({
    entity_type: form.get('entity_type'),
    entity_id: form.get('entity_id'),
  })
  if (!target.success) throw fail(422, 'entity_type and entity_id are required')

  if (!ALLOWED_MIME.has(file.type)) throw fail(415, `Unsupported file type: ${file.type || 'unknown'}`)
  if (file.size > MAX_UPLOAD_BYTES) {
    throw fail(413, `File is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`)
  }

  // Read before storing so a truncated upload fails here rather than leaving a
  // half-written object with a database row pointing at it.
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) throw fail(422, 'The uploaded file is empty')

  const stored = await storeFile(c.env, config, {
    bytes,
    filename: file.name || 'upload',
    mimeType: file.type,
  })

  const { id } = await db.insert(
    `INSERT INTO attachments
       (entity_type, entity_id, filename, mime_type, size_bytes, storage, storage_ref,
        web_view_link, uploaded_by, created_at)
     VALUES (@entity_type, @entity_id, @filename, @mime_type, @size_bytes, @storage, @storage_ref,
             @web_view_link, @uploaded_by, @at)`,
    {
      entity_type: target.data.entity_type,
      entity_id: target.data.entity_id,
      filename: file.name || 'upload',
      mime_type: file.type,
      uploaded_by: c.get('user').id,
      at: now(),
      ...stored,
    }
  )

  return c.json(await db.get('SELECT * FROM attachments WHERE id = @id', { id }), 201)
})

attachments.get('/:id/download', async (c) => {
  const attachment = await c.get('db').get('SELECT * FROM attachments WHERE id = @id', {
    id: c.req.param('id'),
  })
  if (!attachment) throw fail(404, 'Attachment not found')

  // A purged photo is a deliberate state, not a failure: say when and under which
  // policy, so an auditor sees a reason rather than a broken image.
  if (attachment.purged_at) {
    throw fail(410, `This file was purged on ${attachment.purged_at.slice(0, 10)}`, {
      purge_policy: attachment.purge_policy,
    })
  }

  const body = await readFile(c.env, c.get('config'), attachment)
  if (!body) throw fail(404, 'The stored file is missing')

  return new Response(body, {
    headers: {
      'content-type': attachment.mime_type,
      'content-disposition': `attachment; filename="${attachment.filename.replace(/"/g, '')}"`,
    },
  })
})

attachments.delete('/:id', async (c) => {
  const db = c.get('db')
  const attachment = await db.get('SELECT * FROM attachments WHERE id = @id', { id: c.req.param('id') })
  if (!attachment) throw fail(404, 'Attachment not found')

  if (!attachment.purged_at) await deleteFile(c.env, c.get('config'), attachment)
  await db.run('DELETE FROM attachments WHERE id = @id', { id: attachment.id })
  return c.body(null, 204)
})

attachments.get('/storage-status', (c) =>
  c.json({ backend: storageBackend(c.get('config')), max_upload_bytes: MAX_UPLOAD_BYTES })
)

export default attachments
