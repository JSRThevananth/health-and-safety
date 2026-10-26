import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { storeFile, readFile, deleteFile, driveEnabled } from '../services/drive.js'

const router = Router()

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// Evidence is photos and documents; nothing executable.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error(`Unsupported file type: ${file.mimetype}`), { status: 415 }))
    }
    cb(null, true)
  },
})

// entity_type is a free-form owner tag (e.g. 'report', 'inspection'). Domain routes
// are responsible for checking the referenced row actually exists.
const targetSchema = z.object({
  entity_type: z.string().min(1).max(40),
  entity_id: z.coerce.number().int().positive(),
})

router.get('/', validate(targetSchema, 'query'), (req, res) => {
  res.json(
    getDb()
      .prepare(
        `SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, storage,
                web_view_link, uploaded_by, created_at
         FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`
      )
      .all(req.query.entity_type, req.query.entity_id)
  )
})

router.post(
  '/',
  upload.single('file'),
  validate(targetSchema),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(422).json({ error: 'No file uploaded (field name: "file")' })

    const db = getDb()
    const { entity_type, entity_id } = req.body

    const stored = await storeFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    })

    const result = db
      .prepare(
        `INSERT INTO attachments
           (entity_type, entity_id, filename, mime_type, size_bytes, storage, storage_ref, web_view_link, uploaded_by)
         VALUES (@entity_type, @entity_id, @filename, @mime_type, @size_bytes, @storage, @storage_ref, @web_view_link, @uploaded_by)`
      )
      .run({
        entity_type,
        entity_id,
        filename: req.file.originalname,
        mime_type: req.file.mimetype,
        uploaded_by: req.user.id,
        ...stored,
      })

    res.status(201).json(db.prepare('SELECT * FROM attachments WHERE id = ?').get(result.lastInsertRowid))
  })
)

router.get(
  '/:id/download',
  asyncHandler(async (req, res) => {
    const attachment = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id)
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' })

    res.setHeader('Content-Type', attachment.mime_type)
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`)
    const stream = await readFile(attachment)
    stream.on('error', (error) => res.destroy(error))
    stream.pipe(res)
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const db = getDb()
    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id)
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' })

    await deleteFile(attachment)
    db.prepare('DELETE FROM attachments WHERE id = ?').run(attachment.id)
    res.status(204).end()
  })
)

router.get('/storage-status', (req, res) => {
  res.json({ backend: driveEnabled() ? 'gdrive' : 'local', max_upload_bytes: MAX_UPLOAD_BYTES })
})

export default router
