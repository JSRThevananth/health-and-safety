/**
 * Email through Brevo.
 *
 * Brevo rather than Apps Script's own MailApp: MailApp on a consumer Gmail account
 * is capped at 100 recipients a day and sends from the owner's own address. Brevo
 * gives 300 a day on the free tier, proper delivery reporting, and a sender address
 * that is not somebody's personal mailbox.
 *
 * When BREVO_ENABLED is false every send is recorded and logged but not delivered,
 * so development consumes no quota.
 */
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function _logEmail(template, recipients, subject, status, detail) {
  dbTransaction(function () {
    dbInsert('EmailLog', {
      template: template,
      recipients: recipients.join(','),
      subject: subject,
      status: status,
      detail: String(detail || '').slice(0, 1000),
      created_at: new Date().toISOString(),
    });
  });
}

/**
 * Send one email. Failures are logged and swallowed: an alert that cannot be sent
 * must never roll back the quality record that triggered it.
 */
function sendEmail(options) {
  const config = getConfig();
  const recipients = (options.to || []).filter(function (e) { return e; });

  if (recipients.length === 0) {
    _logEmail(options.template, [], options.subject, 'skipped', 'no recipients');
    return { status: 'skipped', reason: 'no recipients' };
  }

  if (!config.brevo.enabled || !config.brevo.apiKey) {
    Logger.log('[mail:dry-run] ' + options.template + ' -> ' + recipients.join(', '));
    _logEmail(options.template, recipients, options.subject, 'skipped', 'brevo disabled');
    return { status: 'skipped', reason: 'brevo disabled' };
  }

  try {
    const response = UrlFetchApp.fetch(BREVO_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'api-key': config.brevo.apiKey, accept: 'application/json' },
      payload: JSON.stringify({
        sender: { email: config.brevo.senderEmail, name: config.brevo.senderName },
        to: recipients.map(function (email) { return { email: email }; }),
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
      }),
      // Handle the error ourselves rather than letting a 4xx throw.
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      _logEmail(options.template, recipients, options.subject, 'failed', code + ' ' + response.getContentText());
      return { status: 'failed', reason: response.getContentText() };
    }

    let messageId = '';
    try { messageId = JSON.parse(response.getContentText()).messageId || ''; } catch (e) { /* not fatal */ }
    _logEmail(options.template, recipients, options.subject, 'sent', messageId);
    return { status: 'sent', messageId: messageId };
  } catch (error) {
    _logEmail(options.template, recipients, options.subject, 'failed', error.message);
    return { status: 'failed', reason: error.message };
  }
}

/**
 * Recipients for a unit's reports.
 *
 * Held per unit, so one station's report never reaches another station's list.
 */
function recipientsForUnit(unitId, reportType) {
  return dbFind('Recipients', function (r) {
    if (Number(r.unit_id) !== Number(unitId)) return false;
    if (Number(r.active) !== 1) return false;
    if (!reportType) return true;
    const types = String(r.report_types || '');
    return types === '' || types.indexOf(reportType) !== -1;
  }).map(function (r) { return r.email; });
}

/** Everyone who should hear about a group-wide matter. */
function omniAdminEmails(tenantId) {
  return dbFind('Users', function (u) {
    return Number(u.tenant_id) === Number(tenantId)
      && u.role === 'omni_admin' && Number(u.active) === 1 && u.email;
  }).map(function (u) { return u.email; });
}

/** Shared layout, so every message from the system looks like the same system. */
function emailLayout(title, rows, body) {
  const cells = rows.map(function (pair) {
    return '<tr><td style="padding:6px 12px 6px 0;color:#616e7c;white-space:nowrap">' + pair[0]
      + '</td><td style="padding:6px 0;font-weight:600">' + pair[1] + '</td></tr>';
  }).join('');

  return {
    subject: title,
    html: '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;color:#1f2933">'
      + '<h2 style="margin:0 0 4px">' + title + '</h2>'
      + (rows.length ? '<table style="border-collapse:collapse;width:100%;margin:16px 0">' + cells + '</table>' : '')
      + '<p style="margin:0;color:#3e4c59">' + body + '</p></div>',
    text: [title, ''].concat(rows.map(function (p) { return p[0] + ': ' + p[1]; })).concat(['', body]).join('\n'),
  };
}

/** The report an inspector sends when they finish. */
function sendInspectionReport(inspectionId) {
  const inspection = resolveInspection(inspectionId);
  if (!inspection) throw new Error('Inspection not found');

  const counts = inspection.summary_counts;
  const layout = emailLayout(
    'Inspection completed - ' + inspection.unit_name,
    [
      ['Unit', inspection.unit_name],
      ['Department', inspection.department || 'Not specified'],
      ['Inspector', inspection.inspector_name],
      ['Checklist', 'v' + inspection.template_version + ' (' + counts.total + ' points)'],
      ['Critical', String(counts.critical)],
      ['Needs improvement', String(counts.needs_improvement)],
      ['Accepted at default', counts.untouched + ' of ' + counts.total],
    ],
    counts.exceptions === 0
      ? 'No findings were raised.'
      : counts.exceptions + ' finding(s) require corrective action.'
  );

  return sendEmail({
    template: 'inspection_report',
    to: recipientsForUnit(inspection.unit_id, 'inspection'),
    subject: layout.subject,
    html: layout.html,
    text: layout.text,
  });
}
