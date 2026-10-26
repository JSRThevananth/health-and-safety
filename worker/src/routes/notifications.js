import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { sendEmail } from '../services/mailer.js'
import { basicNotification } from '../services/emailTemplates.js'
import { requirePermission } from '../middleware/auth.js'
import { sendOverdueDigest } from '../services/digest.js'

const notifications = new Hono()

const testSchema = z.object({
  to: z.string().email(),
  message: z.string().default('If you are reading this, Brevo is wired up correctly.'),
})

/** Send a one-off email to confirm the Brevo integration end to end. */
notifications.post('/test', validateBody(testSchema), async (c) => {
  const body = c.get('body')
  const { subject, html, text } = basicNotification({
    title: 'Test notification',
    rows: [
      ['Sent by', c.get('user').username],
      ['Time', new Date().toISOString()],
    ],
    body: body.message,
  })
  return c.json(
    await sendEmail(c.get('db'), c.get('config'), { template: 'test', to: body.to, subject, html, text })
  )
})

/**
 * The corrective action digest, on demand.
 *
 * Mostly so it can be checked without waiting until quarter to eight: a preview
 * shows exactly who would be written to and what they would read, and sends
 * nothing. Running it for real is there too, for the morning the cron did not
 * fire.
 */
notifications.post('/digest', requirePermission('user.manage'), async (c) => {
  const dryRun = c.req.query('send') !== 'true'
  const report = await sendOverdueDigest(c.get('db'), c.get('config'), { dryRun })
  return c.json({ ...report, dry_run: dryRun })
})

/** Recent send attempts, dry-run skips included - the first place to look when an alert goes missing. */
notifications.get('/log', async (c) =>
  c.json(await c.get('db').all('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100'))
)

export default notifications
