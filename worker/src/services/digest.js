import { today } from '../db.js'
import { sendEmail } from './mailer.js'

/**
 * The daily chase.
 *
 * A corrective action log only works if somebody is reminded of it. This sends
 * each owner what is on their plate, and each unit admin what is outstanding in
 * their units - including the actions nobody has been given, which are the ones
 * that quietly rot.
 *
 * Two rules shape the whole thing:
 *
 *  - Nothing to say, nothing sent. A digest that arrives every morning saying
 *    "0 actions" is a digest people filter into a folder they never open, and
 *    then the one that matters goes there too.
 *  - It runs on its own cron trigger, not the nightly one. A Worker gets 50
 *    subrequests per invocation and the nightly sweep already uses 38; sharing
 *    would mean one of the two silently doing nothing.
 */

/** The most messages one run will send. */
const MAX_EMAILS = 20

/** How far ahead "due soon" looks. */
const SOON_DAYS = 7

const ahead = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

export async function sendOverdueDigest(db, config, { dryRun = false } = {}) {
  const report = { owners: 0, admins: 0, sent: 0, skipped: 0, capped: 0 }
  if (config.digest?.enabled === false) {
    report.skipped = 1
    return { ...report, reason: 'digests are switched off' }
  }

  const now = today()
  const soon = ahead(SOON_DAYS)

  // Everything open that is either late or close to it, with the people it
  // concerns. One query: the whole point of a digest is that it is cheap.
  const rows = await db.all(
    `SELECT c.id, c.title, c.priority, c.due_date, c.owner_id, c.unit_id,
            u.name AS unit_name, u.code AS unit_code,
            owner.email AS owner_email, owner.full_name AS owner_name, owner.active AS owner_active
       FROM capas c
       JOIN units u ON u.id = c.unit_id
       LEFT JOIN users owner ON owner.id = c.owner_id
      WHERE c.status = 'open'
        AND c.due_date IS NOT NULL
        AND c.due_date <= @soon
        AND u.active = 1
      ORDER BY c.due_date, c.id`,
    { soon }
  )

  if (rows.length === 0) return { ...report, reason: 'nothing due' }

  const messages = []

  // One message per owner: their own actions, across every unit they work in.
  const byOwner = new Map()
  for (const row of rows) {
    if (!row.owner_id || !row.owner_email || !row.owner_active) continue
    if (!byOwner.has(row.owner_id)) byOwner.set(row.owner_id, [])
    byOwner.get(row.owner_id).push(row)
  }
  for (const [ownerId, actions] of byOwner) {
    messages.push({
      kind: 'owner',
      to: actions[0].owner_email,
      name: actions[0].owner_name,
      actions,
      key: `owner-${ownerId}`,
    })
  }
  report.owners = byOwner.size

  /*
   * One message per unit admin: everything outstanding in their units, theirs
   * or not. Deliberately overlapping with the owner digests - an admin asked
   * to chase what they cannot see is being asked to do nothing.
   */
  const admins = await db.all(
    `SELECT DISTINCT a.id, a.email, a.full_name, uu.unit_id
       FROM users a
       JOIN user_units uu ON uu.user_id = a.id
      WHERE a.active = 1 AND a.email <> '' AND a.role IN ('unit_admin', 'omni_admin')`
  )
  const omnis = await db.all(
    `SELECT id, email, full_name FROM users
      WHERE active = 1 AND email <> '' AND role = 'omni_admin'`
  )

  const byAdmin = new Map()
  const add = (admin, action) => {
    if (!byAdmin.has(admin.id)) byAdmin.set(admin.id, { admin, actions: [] })
    const bucket = byAdmin.get(admin.id)
    if (!bucket.actions.some((a) => a.id === action.id)) bucket.actions.push(action)
  }
  for (const action of rows) {
    for (const admin of admins) if (admin.unit_id === action.unit_id) add(admin, action)
    // An omni admin spans the tenant and has no rows in user_units.
    for (const admin of omnis) add(admin, action)
  }
  for (const { admin, actions } of byAdmin.values()) {
    messages.push({ kind: 'admin', to: admin.email, name: admin.full_name, actions, key: `admin-${admin.id}` })
  }
  report.admins = byAdmin.size

  // Most urgent first, so a capped run sends the messages that matter most.
  messages.sort((a, b) => overdueCount(b.actions, now) - overdueCount(a.actions, now))
  if (messages.length > MAX_EMAILS) {
    report.capped = messages.length - MAX_EMAILS
    messages.length = MAX_EMAILS
  }

  report.messages = messages.map((m) => ({
    kind: m.kind,
    to: m.to,
    actions: m.actions.length,
    overdue: overdueCount(m.actions, now),
    ...render(m, now, config),
  }))
  if (dryRun) return report

  for (const message of report.messages) {
    // Sent one at a time and counted from what the mailer reports, not from
    // how many were queued: with BREVO_ENABLED false every one of these comes
    // back "skipped", and a digest that logs 20 sent in a dry run is a report
    // that lies.
    const result = await sendEmail(db, config, {
      template: 'capa-digest',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (result.status === 'sent') report.sent += 1
    else report.skipped += 1
  }

  return report
}

const overdueCount = (actions, on) => actions.filter((a) => a.due_date < on).length

/** The message for one person. */
export function render({ kind, name, actions }, on, config) {
  const overdue = actions.filter((a) => a.due_date < on)
  const soon = actions.filter((a) => a.due_date >= on)

  const subject =
    overdue.length > 0
      ? `${overdue.length} corrective action${overdue.length === 1 ? '' : 's'} overdue`
      : `${soon.length} corrective action${soon.length === 1 ? '' : 's'} due this week`

  const link = config.reports.publicUrl ? `${config.reports.publicUrl}/app/actions` : ''

  const list = (rows, heading, colour) =>
    rows.length === 0
      ? ''
      : `<h3 style="margin:18px 0 6px;font-size:14px;color:${colour}">${heading}</h3>
         <table style="border-collapse:collapse;width:100%">${rows
           .map(
             (row) => `<tr>
               <td style="padding:6px 10px 6px 0;color:#616e7c;white-space:nowrap">${row.due_date}</td>
               <td style="padding:6px 10px 6px 0;color:#616e7c;white-space:nowrap">${escape(row.unit_code)}</td>
               <td style="padding:6px 0">${escape(row.title)}${
                 kind === 'admin'
                   ? `<br><small style="color:#829ab1">${
                       row.owner_name ? `owner: ${escape(row.owner_name)}` : 'nobody assigned'
                     }</small>`
                   : ''
               }</td>
             </tr>`
           )
           .join('')}</table>`

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;color:#1f2933">
  <h2 style="margin:0 0 2px">${escape(subject)}</h2>
  <p style="margin:0;color:#616e7c">
    ${kind === 'admin' ? 'Outstanding in your units' : `Assigned to you, ${escape(name || '')}`}.
  </p>
  ${list(overdue, 'Overdue', '#8c1d18')}
  ${list(soon, `Due in the next ${SOON_DAYS} days`, '#8a5300')}
  ${link ? `<p style="margin:20px 0 0"><a href="${link}">Open corrective actions</a></p>` : ''}
  <p style="margin:18px 0 0;font-size:12px;color:#829ab1">
    Sent only when something is outstanding. Closing an action takes it off this list.
  </p>
</div>`

  const text = [
    subject,
    '',
    ...overdue.map((row) => `OVERDUE ${row.due_date} ${row.unit_code} ${row.title}`),
    ...soon.map((row) => `due ${row.due_date} ${row.unit_code} ${row.title}`),
    '',
    link,
  ].join('\n')

  return { subject, html, text }
}

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
