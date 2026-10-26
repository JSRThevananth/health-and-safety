import { readFile } from './storage.js'
import { renderInspectionPdf } from './reportPdf.js'
import { signPhotoToken } from './photoLinks.js'
import { isException } from './inspections.js'

/**
 * Compiling an inspection report.
 *
 * The report has to carry the photos, and the photos live in the inspector's
 * Drive. Two things happen with each one at compile time:
 *
 *  - it is fetched from Drive and attached to the email, so the report is still
 *    complete months later when the photo itself has been purged under the
 *    retention policy;
 *  - it is also referenced by a signed, expiring URL, because Brevo does not
 *    support inline (cid:) images - the recommended way to show a picture in the
 *    body is an ordinary https src, which the Worker serves back out of Drive.
 *
 * Brevo caps a single attachment at 4 MB and the whole message at 20 MB. Photos
 * arrive downscaled by the browser to a few hundred KB, so a normal inspection
 * fits comfortably; the budget below is what stops an unusual one from being
 * rejected by Brevo with the findings still unsent.
 */

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
// Well under Brevo's 20 MB, because the body and its encoding count too, and an
// email refused for size is worse than one with its last photos linked instead.
const MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024

/**
 * The most photos one report will fetch back out of storage.
 *
 * A second budget, and it binds before the byte one does. Every photo costs a
 * subrequest to retrieve, a Worker gets 50 per request, and sending a report
 * already spends about 17 on the database, the Drive token and Brevo. Measured:
 * 32 photos came to 48 subrequests and 40 came to 56, which does not degrade -
 * the platform refuses the request and the inspector loses the whole report.
 *
 * Thirty, so there is room for the query count to grow. Photos past it are
 * listed with their link, exactly as the byte budget does, so the report still
 * accounts for every one of them.
 */
export const MAX_PHOTO_FETCHES = 30

const RATING_LABEL = {
  satisfactory: 'Satisfactory',
  needs_improvement: 'Needs improvement',
  critical: 'Critical',
  na: 'Not applicable',
}

// Paired with a word in every case: colour alone is not a label, and a
// red/green distinction is invisible to a good number of readers.
const RATING_STYLE = {
  critical: 'background:#fce8e6;color:#8c1d18;',
  needs_improvement: 'background:#fef4e5;color:#8a5300;',
  na: 'background:#eceff1;color:#455a64;',
  satisfactory: 'background:#e6f4ea;color:#17603a;',
}

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Pull every photo attached to this inspection out of Drive.
 *
 * One failure does not sink the report: a photo that cannot be fetched is listed
 * as unavailable, with the reason, rather than silently left out - a report that
 * quietly drops evidence is worse than one that says a photo is missing.
 */
async function collectPhotos(env, config, db, inspectionId) {
  const rows = await db.all(
    `SELECT * FROM attachments
     WHERE entity_type = 'inspection' AND entity_id = @id
     ORDER BY created_at`,
    { id: inspectionId }
  )

  const photos = []
  let budget = MAX_TOTAL_ATTACHMENT_BYTES
  let fetches = 0

  for (const row of rows) {
    const photo = {
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      // The note the inspector was writing when they took it; set by the upload.
      caption: row.filename,
      attached: false,
      unavailable: null,
      url: null,
    }

    if (row.purged_at) {
      photo.unavailable = `purged on ${row.purged_at.slice(0, 10)} under ${row.purge_policy || 'the retention policy'}`
      photos.push(photo)
      continue
    }

    photo.url = await photoUrl(config, row)

    if (row.size_bytes > MAX_ATTACHMENT_BYTES) {
      photo.unavailable = 'too large to attach - use the link'
      photos.push(photo)
      continue
    }
    if (row.size_bytes > budget) {
      photo.unavailable = 'not attached to keep the email within its size limit - use the link'
      photos.push(photo)
      continue
    }
    if (fetches >= MAX_PHOTO_FETCHES) {
      // Retrieving this one would risk the request being refused outright, and
      // a report that arrives with its last photos linked beats one that does
      // not arrive at all.
      photo.unavailable = 'not attached to keep the report within the platform\'s limits - use the link'
      photos.push(photo)
      continue
    }

    try {
      fetches += 1
      const body = await readFile(env, config, row)
      if (!body) throw new Error('the stored file is missing')
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      // Kept, not just encoded: the PDF embeds the same photograph, and
      // fetching it from Drive a second time would spend a subrequest the
      // report may need for the next one.
      photo.bytes = bytes
      photo.content = base64(bytes)
      photo.attached = true
      budget -= bytes.byteLength
    } catch (error) {
      photo.unavailable = `could not be retrieved from Drive (${error.message})`
    }
    photos.push(photo)
  }

  return photos
}

/** A link an email client can load without a token of its own. */
async function photoUrl(config, attachment) {
  if (!config.reports.publicUrl) return null
  const token = await signPhotoToken(attachment.id, config)
  return `${config.reports.publicUrl}/api/photos/${attachment.id}?t=${token}`
}

/**
 * Build the report for one inspection: subject, HTML, plain text, and the
 * attachments to send with it.
 */
export async function compileInspectionReport(env, config, db, inspection) {
  const photos = await collectPhotos(env, config, db, inspection.id)
  const byItem = new Map()
  for (const photo of photos) {
    // Photos are attached to the inspection, and the upload records which item
    // they belong to in the filename prefix the client sets.
    const match = /^item-(\d+)-/.exec(photo.filename)
    const key = match ? Number(match[1]) : null
    if (!byItem.has(key)) byItem.set(key, [])
    byItem.get(key).push(photo)
  }

  const findings = inspection.sections
    .flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
    .filter((item) => item.rating !== 'satisfactory' || item.note.trim())

  const counts = inspection.summary_counts
  const date = (inspection.submitted_at || inspection.updated_at || '').slice(0, 10)
  const subject = `${inspection.unit_code} inspection ${date} - ${counts.exceptions} finding${counts.exceptions === 1 ? '' : 's'}`

  /*
   * The whole report as one PDF, and that PDF instead of the loose photographs.
   *
   * It carries the same images, so attaching both would double the size of an
   * email that already has a 20 MB ceiling - and a recipient who has to file
   * the report would rather have one document than a message plus eight JPEGs.
   * If anything in the PDF fails the photographs are attached as before: a
   * report that arrives with its evidence in a less convenient shape beats one
   * that does not arrive.
   */
  let pdf = null
  try {
    pdf = await renderInspectionPdf({ inspection, findings, counts, date, photos })
  } catch (error) {
    console.error(`[reports] could not build the PDF for inspection ${inspection.id}:`, error.message)
  }

  const pdfName = `${inspection.unit_code}-inspection-${date}.pdf`
  const loosePhotos = photos
    .filter((p) => p.attached)
    .map((p) => ({ name: p.filename, content: p.content }))

  return {
    subject,
    html: renderHtml({
      inspection,
      findings,
      counts,
      date,
      byItem,
      unattached: byItem.get(null) || [],
      pdfName: pdf ? pdfName : null,
    }),
    text: renderText({ inspection, findings, counts, date }),
    pdf,
    pdfName,
    // No attachment entry for the signatures: they are inlined in the body as
    // data URLs, because they must still render when the photos from the same
    // inspection have been purged and the links have expired.
    attachments: pdf ? [{ name: pdfName, content: base64(pdf) }] : loosePhotos,
    photoSummary: {
      total: photos.length,
      attached: photos.filter((p) => p.attached).length,
      unavailable: photos.filter((p) => p.unavailable).map((p) => ({ name: p.filename, why: p.unavailable })),
    },
  }
}

function renderHtml({ inspection, findings, counts, date, byItem, unattached, pdfName = null }) {
  const chip = (rating) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;${RATING_STYLE[rating]}">${RATING_LABEL[rating]}</span>`

  const photoBlock = (list) => {
    if (!list || list.length === 0) return ''
    return `<div style="margin-top:10px">${list
      .map((photo) => {
        if (photo.unavailable) {
          return `<p style="margin:4px 0;font-size:12px;color:#616e7c">Photo ${escape(photo.filename)} — ${escape(photo.unavailable)}</p>`
        }
        const img = photo.url
          ? `<a href="${escape(photo.url)}"><img src="${escape(photo.url)}" alt="${escape(photo.filename)}" style="max-width:260px;border-radius:8px;border:1px solid #d7dde3"></a>`
          : `<span style="font-size:12px;color:#616e7c">${escape(photo.filename)} (attached)</span>`
        return `<div style="display:inline-block;margin:0 8px 8px 0;vertical-align:top">${img}</div>`
      })
      .join('')}</div>`
  }

  const findingRows = findings.length
    ? findings
        .map(
          (item) => `
  <tr><td style="padding:14px 0;border-top:1px solid #e4e7eb">
    <div style="font-size:12px;color:#616e7c">${escape(item.section)} · ${escape(item.code)}</div>
    <div style="margin:4px 0 6px;font-weight:600">${escape(item.text)}</div>
    ${chip(item.rating)}
    ${item.note.trim() ? `<p style="margin:8px 0 0;color:#3e4c59">${escape(item.note)}</p>` : ''}
    ${photoBlock(byItem.get(item.id))}
  </td></tr>`
        )
        .join('')
    : `<tr><td style="padding:16px 0;color:#3e4c59">No findings. Every point was accepted at its default rating.</td></tr>`

  return `<!doctype html>
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:680px;color:#1f2933">
  <h2 style="margin:0 0 2px">${escape(inspection.unit_name)} — health &amp; safety inspection</h2>
  <p style="margin:0 0 18px;color:#616e7c">
    ${escape(date)} · ${escape(inspection.department || 'All departments')}${inspection.shift ? ` · ${escape(inspection.shift)} shift` : ''}
    · inspected by ${escape(inspection.inspector_name)} · checklist v${escape(inspection.template_version)}
  </p>

  <table style="border-collapse:collapse;width:100%;margin-bottom:8px">
    <tr>
      ${[
        ['Critical', counts.critical, RATING_STYLE.critical],
        ['Needs improvement', counts.needs_improvement, RATING_STYLE.needs_improvement],
        ['Satisfactory', counts.satisfactory, RATING_STYLE.satisfactory],
        ['Not applicable', counts.na, RATING_STYLE.na],
      ]
        .map(
          ([label, value, style]) =>
            `<td style="padding:10px;border-radius:8px;text-align:center;${style}">
               <div style="font-size:22px;font-weight:700">${value}</div>
               <div style="font-size:12px">${label}</div>
             </td><td style="width:8px"></td>`
        )
        .join('')}
    </tr>
  </table>
  <p style="margin:0 0 18px;font-size:12px;color:#616e7c">
    ${counts.total} points checked · ${counts.touched} recorded by the inspector ·
    ${counts.untouched} accepted at the default rating
  </p>

  ${inspection.summary.trim() ? `<p style="margin:0 0 18px;padding:12px;background:#f5f7fa;border-radius:8px">${escape(inspection.summary)}</p>` : ''}

  <h3 style="margin:24px 0 0">Findings</h3>
  <table style="border-collapse:collapse;width:100%">${findingRows}</table>
  ${unattached.length ? `<h3 style="margin:24px 0 0">Other photos</h3>${photoBlock(unattached)}` : ''}

  ${renderSignatures(inspection.signatures)}

  <p style="margin:28px 0 0;font-size:12px;color:#829ab1">
    ${
      pdfName
        ? `The full report is attached as <b>${escape(pdfName)}</b>, photographs included. The links
           above expire, so keep the PDF if you need this later.`
        : `Photos in this email are also attached. The links expire, so keep the attachments
           if you need them later.`
    }
  </p>
</div>`
}

const ROLE_LABEL = { inspector: 'Inspector', supervisor: 'Department supervisor' }

/**
 * The signature block.
 *
 * Inline data URLs rather than linked images: a signature has to render in an
 * email opened two years from now, long after the photo links have expired and
 * the photos themselves have been purged.
 */
function renderSignatures(signatures = []) {
  if (signatures.length === 0) return ''

  return `<h3 style="margin:28px 0 8px">Signed</h3>
<table style="border-collapse:collapse"><tr>${signatures
    .map(
      (signature) => `<td style="padding:0 24px 0 0;vertical-align:top">
    <img src="${escape(signature.image)}" alt="Signature of ${escape(signature.signed_name)}"
         style="height:56px;max-width:220px;display:block">
    <div style="border-top:1px solid #9aa5b1;padding-top:4px;margin-top:2px;font-weight:600">${escape(signature.signed_name)}</div>
    <div style="font-size:12px;color:#616e7c">${escape(ROLE_LABEL[signature.role] || signature.role)} · ${escape(signature.signed_at.slice(0, 10))}</div>
  </td>`
    )
    .join('')}</tr></table>`
}

function renderText({ inspection, findings, counts, date }) {
  const lines = [
    `${inspection.unit_name} - health & safety inspection`,
    `${date} | ${inspection.department || 'All departments'} | inspected by ${inspection.inspector_name}`,
    '',
    `Critical: ${counts.critical}   Needs improvement: ${counts.needs_improvement}   Satisfactory: ${counts.satisfactory}   N/A: ${counts.na}`,
    `${counts.total} points checked, ${counts.untouched} accepted at the default rating.`,
    '',
  ]
  if (inspection.summary.trim()) lines.push(inspection.summary, '')

  for (const signature of inspection.signatures || []) {
    const role = signature.role === 'inspector' ? 'inspector' : 'department supervisor'
    lines.push(`Signed by ${signature.signed_name} (${role}) on ${signature.signed_at.slice(0, 10)}`)
  }
  if ((inspection.signatures || []).length) lines.push('')

  lines.push('FINDINGS')
  if (findings.length === 0) {
    lines.push('  None.')
  } else {
    for (const item of findings) {
      lines.push(`  [${RATING_LABEL[item.rating]}] ${item.code} - ${item.text}`)
      if (item.note.trim()) lines.push(`      ${item.note}`)
    }
  }
  return lines.join('\n')
}

/** Who this report goes to: the unit's list, optionally narrowed by the sender. */
export async function reportRecipients(db, unitId, { only = null, reportType = 'inspection' } = {}) {
  const rows = await db.all(
    `SELECT * FROM unit_recipients
     WHERE unit_id = @u AND report_type = @r AND active = 1`,
    { u: unitId, r: reportType }
  )
  if (!only) return rows.filter((r) => r.default_selected)
  const wanted = new Set(only.map(Number))
  return rows.filter((r) => wanted.has(r.id))
}

function base64(bytes) {
  // Chunked: String.fromCharCode spreads its argument onto the stack, and a
  // whole photo at once overflows it.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export const isFinding = isException
