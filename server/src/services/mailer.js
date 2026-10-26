import { config } from '../config.js'
import { getDb } from '../db/index.js'

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

function logEmail(template, recipients, subject, status, detail = '') {
  getDb()
    .prepare(
      `INSERT INTO email_log (template, recipients, subject, status, detail)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(template, recipients.join(','), subject, status, String(detail).slice(0, 1000))
}

/**
 * Send a transactional email through Brevo.
 *
 * When BREVO_ENABLED is false (the default, and how local dev runs) the message is
 * recorded and logged but never sent, so no free-tier quota is consumed. Delivery
 * failures are logged and swallowed: an alert that cannot be sent must not roll back
 * the quality record that triggered it.
 */
export async function sendEmail({ template, to, subject, html, text }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (recipients.length === 0) {
    logEmail(template, [], subject, 'skipped', 'no recipients')
    return { status: 'skipped', reason: 'no recipients' }
  }

  if (!config.brevo.enabled || !config.brevo.apiKey) {
    console.info(`[mail:dry-run] ${template} -> ${recipients.join(', ')} :: ${subject}`)
    logEmail(template, recipients, subject, 'skipped', 'brevo disabled')
    return { status: 'skipped', reason: 'brevo disabled' }
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.brevo.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
        to: recipients.map((email) => ({ email })),
        subject,
        htmlContent: html,
        textContent: text,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error(`[mail:failed] ${template} ${response.status} ${detail}`)
      logEmail(template, recipients, subject, 'failed', `${response.status} ${detail}`)
      return { status: 'failed', reason: detail }
    }

    const body = await response.json().catch(() => ({}))
    logEmail(template, recipients, subject, 'sent', body.messageId || '')
    return { status: 'sent', messageId: body.messageId }
  } catch (error) {
    console.error(`[mail:failed] ${template}`, error)
    logEmail(template, recipients, subject, 'failed', error.message)
    return { status: 'failed', reason: error.message }
  }
}

/** Look up notification recipients by role, e.g. recipientsByRole('omni_admin'). */
export function recipientsByRole(...roles) {
  if (roles.length === 0) return []
  const placeholders = roles.map(() => '?').join(',')
  return getDb()
    .prepare(
      `SELECT email FROM users WHERE role IN (${placeholders}) AND active = 1 AND email <> ''`
    )
    .all(...roles)
    .map((row) => row.email)
}
