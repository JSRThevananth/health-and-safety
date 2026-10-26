/**
 * Email layouts. Each builder returns { subject, html, text } ready for sendEmail().
 * Named emailTemplates to avoid confusion with services/formTemplates.js, which handles
 * the per-unit checklist form templates.
 */
export function basicNotification({ title, rows = [], body = '' }) {
  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;color:#1f2933">
  <h2 style="margin:0 0 4px">${title}</h2>
  ${
    rows.length
      ? `<table style="border-collapse:collapse;width:100%;margin:16px 0">${rows
          .map(
            ([label, value]) => `<tr>
      <td style="padding:6px 12px 6px 0;color:#616e7c;white-space:nowrap">${label}</td>
      <td style="padding:6px 0;font-weight:600">${value}</td>
    </tr>`
          )
          .join('')}</table>`
      : ''
  }
  <p style="margin:0;color:#3e4c59">${body}</p>
</div>`

  const text = [title, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', body].join('\n')
  return { subject: title, html, text }
}
