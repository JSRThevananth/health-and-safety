import { now } from '../db.js'

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

async function logEmail(db, template, recipients, subject, status, detail = '', entity = null) {
  await db.run(
    `INSERT INTO email_log (template, recipients, subject, status, detail, entity_type, entity_id, created_at)
     VALUES (@template, @recipients, @subject, @status, @detail, @entity_type, @entity_id, @at)`,
    {
      template,
      recipients: recipients.join(','),
      subject,
      status,
      detail: String(detail).slice(0, 1000),
      entity_type: entity?.type || '',
      entity_id: entity?.id ?? null,
      at: now(),
    }
  )
}

/**
 * Send a transactional email through Brevo.
 *
 * When BREVO_ENABLED is false (the default, and how local development runs) the
 * message is recorded but never sent, so no free-tier quota is consumed. Delivery
 * failures are logged and swallowed: an alert that cannot be sent must not roll
 * back the quality record that triggered it.
 */
export async function sendEmail(db, config, { template, to, subject, html, text, attachments = [], entity = null }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (recipients.length === 0) {
    await logEmail(db, template, [], subject, 'skipped', 'no recipients', entity)
    return { status: 'skipped', reason: 'no recipients' }
  }

  if (!config.brevo.enabled || !config.brevo.apiKey) {
    await logEmail(db, template, recipients, subject, 'skipped', 'brevo disabled', entity)
    return { status: 'skipped', reason: 'brevo disabled', recipients, attachments: attachments.length }
  }

  // Brevo caps one attachment at 4 MB and a message at 20 MB. The compiler keeps
  // within that, but a refusal here loses the whole report, so it is checked
  // rather than trusted.
  const totalBytes = attachments.reduce((sum, a) => sum + Math.ceil((a.content?.length || 0) * 0.75), 0)
  if (totalBytes > 18 * 1024 * 1024) {
    await logEmail(db, template, recipients, subject, 'failed', `attachments total ${totalBytes} bytes`, entity)
    return { status: 'failed', reason: 'The attached photos exceed what the email provider accepts' }
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
        // Brevo rejects an empty attachment array, so the key is omitted when
        // there is nothing to attach rather than sent as [].
        ...(attachments.length ? { attachment: attachments } : {}),
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      await logEmail(db, template, recipients, subject, 'failed', `${response.status} ${detail}`, entity)
      return { status: 'failed', reason: detail }
    }

    const body = await response.json().catch(() => ({}))
    await logEmail(db, template, recipients, subject, 'sent', body.messageId || '', entity)
    return { status: 'sent', messageId: body.messageId }
  } catch (error) {
    await logEmail(db, template, recipients, subject, 'failed', error.message, entity)
    return { status: 'failed', reason: error.message }
  }
}

/** Look up notification recipients by role, e.g. recipientsByRole(db, 'omni_admin'). */
export async function recipientsByRole(db, tenantId, ...roles) {
  if (roles.length === 0) return []
  const list = roles.map((r) => `'${String(r).replace(/[^a-z_]/g, '')}'`).join(',')
  return db.pluck(
    `SELECT email FROM users
     WHERE tenant_id = @t AND role IN (${list}) AND active = 1 AND email <> ''`,
    { t: tenantId }
  )
}
