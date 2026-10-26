import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { canAccessUnit } from '../services/permissions.js'
import { resolveInspection } from '../services/inspections.js'
import { compileInspectionReport, reportRecipients } from '../services/reports.js'
import { sendEmail } from '../services/mailer.js'

const reports = new Hono()

async function loadScoped(c) {
  const inspection = await c.get('db').get('SELECT * FROM inspections WHERE id = @id', {
    id: c.req.param('id'),
  })
  if (!inspection || !canAccessUnit(c.get('user'), inspection.unit_id)) {
    throw fail(404, 'Inspection not found')
  }
  return inspection
}

/** Who would receive this report, with the unit's defaults already ticked. */
reports.get('/:id/recipients', requirePermission('report.view'), async (c) => {
  const inspection = await loadScoped(c)
  const rows = await c.get('db').all(
    `SELECT id, email, name, default_selected FROM unit_recipients
     WHERE unit_id = @u AND report_type = 'inspection' AND active = 1
     ORDER BY email`,
    { u: inspection.unit_id }
  )
  return c.json(rows.map((r) => ({ ...r, default_selected: Boolean(r.default_selected) })))
})

/**
 * The report as the recipients will see it, without sending anything.
 *
 * Worth having for its own sake, but mainly because it exercises the whole
 * compile path - including fetching every photo back out of Drive - so a broken
 * Drive credential is found here rather than by a report that silently arrives
 * with no evidence in it.
 */
reports.get('/:id/report/preview', requirePermission('report.view'), async (c) => {
  const inspection = await loadScoped(c)
  const resolved = await resolveInspection(c.get('db'), inspection.id)
  const report = await compileInspectionReport(c.env, c.get('config'), c.get('db'), resolved)

  if (c.req.query('format') === 'html') {
    return c.html(report.html)
  }
  return c.json({
    subject: report.subject,
    html: report.html,
    text: report.text,
    photos: report.photoSummary,
    recipients: await reportRecipients(c.get('db'), inspection.unit_id),
  })
})

const sendSchema = z.object({
  // Which of the unit's recipients to send to. Omitted means the unit's
  // defaults; an empty list is a mistake, not "send to nobody quietly".
  recipient_ids: z.array(z.coerce.number().int().positive()).optional(),
  // Addresses typed in at send time, for a one-off: a visiting auditor.
  extra_emails: z.array(z.string().email()).max(10).default([]),
})

reports.post('/:id/report', requirePermission('report.export'), validateBody(sendSchema), async (c) => {
  const db = c.get('db')
  const config = c.get('config')
  const inspection = await loadScoped(c)
  const body = c.get('body')

  // A draft is still being written. Sending one would put findings in front of a
  // station manager that the inspector has not finished describing.
  if (inspection.status === 'draft') {
    throw fail(409, 'Submit the inspection before sending its report')
  }

  const chosen = await reportRecipients(db, inspection.unit_id, { only: body.recipient_ids })
  const to = [...new Set([...chosen.map((r) => r.email), ...body.extra_emails])]
  if (to.length === 0) {
    throw fail(422, 'No recipients. Add one to the unit, or name one on this send.')
  }

  const resolved = await resolveInspection(db, inspection.id)
  const report = await compileInspectionReport(c.env, config, db, resolved)

  const result = await sendEmail(db, config, {
    template: 'inspection-report',
    to,
    subject: report.subject,
    html: report.html,
    text: report.text,
    attachments: report.attachments,
    entity: { type: 'inspection', id: inspection.id },
  })

  return c.json({
    ...result,
    recipients: to,
    // Named rather than counted: "3 of 4 photos attached" is the thing a quality
    // manager needs to notice before forwarding the report to a client.
    photos: report.photoSummary,
  })
})

/**
 * The report as a PDF, for filing or printing.
 *
 * The same document the recipients get attached to their email, so what is
 * filed and what was sent cannot differ.
 */
reports.get('/:id/report.pdf', requirePermission('report.view'), async (c) => {
  const inspection = await loadScoped(c)
  const resolved = await resolveInspection(c.get('db'), inspection.id)
  const report = await compileInspectionReport(c.env, c.get('config'), c.get('db'), resolved)

  if (!report.pdf) throw fail(500, 'The report could not be rendered as a PDF')

  return new Response(report.pdf, {
    headers: {
      'content-type': 'application/pdf',
      // inline, so a tap on a phone opens it in the viewer rather than
      // dropping a file the person then has to go and find.
      'content-disposition': `inline; filename="${report.pdfName}"`,
    },
  })
})

/** Everything sent for this inspection, so "did they get it" is answerable. */
reports.get('/:id/report/log', requirePermission('report.view'), async (c) => {
  const inspection = await loadScoped(c)
  return c.json(
    await c.get('db').all(
      `SELECT * FROM email_log WHERE entity_type = 'inspection' AND entity_id = @id
       ORDER BY created_at DESC`,
      { id: inspection.id }
    )
  )
})

export default reports
