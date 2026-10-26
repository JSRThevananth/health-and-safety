import { Hono } from 'hono'
import { fail } from '../middleware/errors.js'
import { readFile } from '../services/storage.js'
import { verifyPhotoToken } from '../services/photoLinks.js'

/**
 * Photos for an emailed report.
 *
 * Deliberately outside the authenticated routes: this is what an email client
 * loads, and it cannot send a bearer token. The signed token in the query string
 * is the credential - it names one attachment and expires.
 */
const photos = new Hono()

photos.get('/:id', async (c) => {
  const config = c.get('config')
  const id = c.req.param('id')

  if (!(await verifyPhotoToken(id, c.req.query('t'), config))) {
    // One message for a bad signature, a wrong id and an expired link alike, so
    // the response cannot be used to work out which part was wrong.
    throw fail(403, 'This photo link is not valid or has expired')
  }

  const attachment = await c.get('db').get('SELECT * FROM attachments WHERE id = @id', { id })
  if (!attachment) throw fail(404, 'Photo not found')
  if (attachment.purged_at) {
    throw fail(410, `This photo was purged on ${attachment.purged_at.slice(0, 10)}`)
  }

  const body = await readFile(c.env, config, attachment)
  if (!body) throw fail(404, 'The stored file is missing')

  return new Response(body, {
    headers: {
      'content-type': attachment.mime_type,
      // Cached at the edge for a day: a report opened by eight recipients should
      // not be eight round trips to Drive.
      'cache-control': 'private, max-age=86400',
      'content-disposition': `inline; filename="${attachment.filename.replace(/"/g, '')}"`,
    },
  })
})

export default photos
