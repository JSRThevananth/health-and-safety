import { createPdf, prepareImage } from './pdf.js'

/**
 * The inspection report as a PDF.
 *
 * Recipients file reports; an email is not a filing format. This is the same
 * content as the emailed report - the findings, the photographs, the
 * signatures - laid out for paper, so it can be printed for an audit folder or
 * handed to a client as a single self-contained document.
 *
 * Self-contained is the point. The photographs are inside the file, so it still
 * shows the evidence after the retention window has purged the originals from
 * Drive and the links in the email have expired.
 */

const RATING_LABEL = {
  satisfactory: 'Satisfactory',
  needs_improvement: 'Needs improvement',
  critical: 'Critical',
  na: 'Not applicable',
}

// Dark enough to read when the report is printed in black and white, where the
// word next to it is doing the real work anyway.
const RATING_COLOR = {
  critical: [0.55, 0.11, 0.09],
  needs_improvement: [0.54, 0.33, 0],
  na: [0.27, 0.35, 0.39],
  satisfactory: [0.09, 0.38, 0.23],
}

const ROLE_LABEL = { inspector: 'Inspector', supervisor: 'Department supervisor' }

/**
 * `photos` are the rows the report compiler already fetched from Drive, bytes
 * included. Passing them in rather than reading them again matters: a Worker
 * gets 50 subrequests per request, and fetching every photograph twice would
 * halve the number of them a report can carry.
 */
export async function renderInspectionPdf({ inspection, findings, counts, date, photos = [] }) {
  const byItem = new Map()
  for (const photo of photos) {
    const match = /^item-(\d+)-/.exec(photo.filename)
    const key = match ? Number(match[1]) : null
    if (!byItem.has(key)) byItem.set(key, [])
    byItem.get(key).push(photo)
  }

  const doc = createPdf({
    title: `${inspection.unit_code} inspection ${date}`,
    author: inspection.inspector_name || 'QA Platform',
    footer: (page, total) =>
      `${inspection.unit_code} inspection #${inspection.id} - ${date} - page ${page} of ${total}`,
  })

  doc.text(`${inspection.unit_name} - health & safety inspection`, { size: 17, bold: true, gap: 2 })
  doc.text(
    [
      date,
      inspection.department || 'All departments',
      inspection.shift ? `${inspection.shift} shift` : null,
      `checklist v${inspection.template_version}`,
    ]
      .filter(Boolean)
      .join('  ·  '),
    { size: 10, color: [0.38, 0.43, 0.48], gap: 10 }
  )

  doc.rule()
  doc.field('Inspector', inspection.inspector_name || '-')
  doc.field('Status', inspection.status === 'signed' ? 'Signed off' : 'Submitted')
  doc.field(
    'Result',
    `${counts.critical} critical · ${counts.needs_improvement} needs improvement · ` +
      `${counts.na} not applicable · ${counts.satisfactory} satisfactory`
  )
  doc.field(
    'Coverage',
    `${counts.total} points checked, ${counts.touched} recorded by the inspector, ` +
      `${counts.untouched} accepted at the default rating`
  )
  if (inspection.summary?.trim()) doc.field('Summary', inspection.summary.trim())
  doc.rule()

  doc.space(4)
  doc.text(`Findings (${findings.length})`, { size: 13, bold: true, gap: 6 })

  if (findings.length === 0) {
    doc.text('No findings. Every point was accepted at its default rating.', {
      size: 10,
      color: [0.24, 0.3, 0.35],
    })
  }

  for (const finding of findings) {
    doc.text(`${finding.section} · ${finding.code}`, { size: 8.5, color: [0.38, 0.43, 0.48], gap: 1 })
    doc.text(finding.text, { size: 11, bold: true, gap: 2 })
    doc.text(RATING_LABEL[finding.rating] || finding.rating, {
      size: 9.5,
      bold: true,
      color: RATING_COLOR[finding.rating],
      gap: finding.note?.trim() ? 2 : 4,
    })
    if (finding.note?.trim()) doc.text(finding.note.trim(), { size: 10, gap: 4 })

    await placePhotos(doc, byItem.get(finding.id))
    doc.rule({ gap: 6, shade: 0.88 })
  }

  const loose = byItem.get(null) || []
  if (loose.length) {
    doc.space(6)
    doc.text('Other photographs', { size: 13, bold: true, gap: 6 })
    await placePhotos(doc, loose)
  }

  await renderSignatures(doc, inspection.signatures)

  doc.space(10)
  doc.text(
    `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from inspection record #${inspection.id}. ` +
      'Photographs are embedded in this file and remain readable after the originals are purged under the retention policy.',
    { size: 8, color: [0.45, 0.5, 0.55] }
  )

  return doc.build()
}

/**
 * The photographs for one finding.
 *
 * A photograph that could not be fetched, or was purged, is named with the
 * reason rather than left out: a report that quietly drops its evidence is
 * worse than one that says a photograph is missing.
 */
async function placePhotos(doc, list) {
  for (const photo of list || []) {
    if (!photo.bytes) {
      doc.text(`Photo ${photo.filename} - ${photo.unavailable || 'not included'}`, {
        size: 9,
        color: [0.38, 0.43, 0.48],
        indent: 8,
        gap: 2,
      })
      continue
    }

    const image = await prepareImage(photo.bytes, photo.mimeType)
    if (!image) {
      doc.text(`Photo ${photo.filename} - attached to the email; not embeddable here`, {
        size: 9,
        color: [0.38, 0.43, 0.48],
        indent: 8,
        gap: 2,
      })
      continue
    }
    doc.image(image, { maxWidth: 300, maxHeight: 220, gap: 4 })
  }
}

async function renderSignatures(doc, signatures = []) {
  if (!signatures.length) return

  doc.space(8)
  doc.text('Signed', { size: 13, bold: true, gap: 6 })

  for (const signature of signatures) {
    const image = await prepareImage(dataUrlBytes(signature.image), 'image/png')
    // The drawing when it can be read, the attestation always: a signature
    // block that is only a picture says nothing once the picture fails.
    if (image) doc.image(image, { maxWidth: 200, maxHeight: 70, gap: 2 })
    doc.text(
      `${signature.signed_name} — ${ROLE_LABEL[signature.role] || signature.role}, signed ${String(
        signature.signed_at || ''
      ).replace('T', ' ').replace('Z', ' UTC')}`,
      { size: 9.5, gap: 8 }
    )
  }
}

/** The bytes inside a `data:image/png;base64,...` URL, or null. */
export function dataUrlBytes(value) {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(String(value || ''))
  if (!match) return null
  try {
    const binary = atob(match[1])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
