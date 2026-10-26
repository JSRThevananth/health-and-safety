import { Router } from 'express'
import { z } from 'zod'
import { getDb } from '../db/index.js'
import { validate, asyncHandler } from '../middleware/validate.js'
import { sendEmail } from '../services/mailer.js'
import { basicNotification } from '../services/emailTemplates.js'

const router = Router()

const testSchema = z.object({
  to: z.string().email(),
  message: z.string().default('If you are reading this, Brevo is wired up correctly.'),
})

/** Send a one-off email to confirm the Brevo integration end to end. */
router.post(
  '/test',
  validate(testSchema),
  asyncHandler(async (req, res) => {
    const { subject, html, text } = basicNotification({
      title: 'Test notification',
      rows: [['Sent by', req.user.username], ['Time', new Date().toISOString()]],
      body: req.body.message,
    })
    res.json(await sendEmail({ template: 'test', to: req.body.to, subject, html, text }))
  })
)

/** Recent send attempts, including dry-run skips - the first place to look when an alert goes missing. */
router.get('/log', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 100').all())
})

export default router
