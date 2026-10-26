import { now } from '../db.js'
import { getPublishedTemplate, resolveTemplate } from './formTemplates.js'
import { signaturesFor } from './signatures.js'

export const RATINGS = ['satisfactory', 'needs_improvement', 'critical', 'na']
export const DEFAULT_RATING = 'satisfactory'
export const isException = (r) => r === 'needs_improvement' || r === 'critical'

/**
 * Who may change an inspection, by status.
 *
 * draft     - the inspector's own working copy, freely editable
 * submitted - locked to the inspector; waiting on the unit admin
 * signed    - immutable to everyone, which is what makes it audit evidence
 */
export const isEditable = (inspection) => inspection.status === 'draft'

/** Return the inspector's open draft for a unit, creating one if none exists. */
export async function openDraft(db, unitId, inspectorId) {
  const existing = await db.get(
    `SELECT * FROM inspections WHERE unit_id = @u AND inspector_id = @i AND status = 'draft'`,
    { u: unitId, i: inspectorId }
  )
  if (existing) return { inspection: existing, created: false }

  const template = await getPublishedTemplate(db, unitId)
  if (!template) return { error: 'This unit has no published checklist yet', status: 409 }

  const { id } = await db.insert(
    `INSERT INTO inspections (unit_id, template_id, inspector_id, started_at, updated_at)
     VALUES (@unit_id, @template_id, @inspector_id, @at, @at)`,
    { unit_id: unitId, template_id: template.id, inspector_id: inspectorId, at: now() }
  )
  return {
    inspection: await db.get('SELECT * FROM inspections WHERE id = @id', { id }),
    created: true,
  }
}

/**
 * Merge the pinned template with the stored deviations into the full record.
 * Items with no stored row are satisfactory and untouched - which is how the
 * "accepted at default" count is derived rather than stored.
 */
export async function resolveInspection(db, inspectionId) {
  const inspection = await db.get('SELECT * FROM inspections WHERE id = @id', { id: inspectionId })
  if (!inspection) return null

  const [template, storedRows, inspector, unit, signatures] = await Promise.all([
    resolveTemplate(db, inspection.template_id),
    db.all('SELECT * FROM inspection_items WHERE inspection_id = @i', { i: inspectionId }),
    db.get('SELECT full_name, initials FROM users WHERE id = @id', { id: inspection.inspector_id }),
    db.get('SELECT name, code FROM units WHERE id = @id', { id: inspection.unit_id }),
    signaturesFor(db, inspectionId),
  ])

  const stored = new Map(storedRows.map((row) => [row.template_item_id, row]))

  const sections = template.sections
    .filter((section) => section.enabled)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => item.enabled)
        .map((item) => {
          const entry = stored.get(item.id)
          return {
            ...item,
            rating: entry?.rating ?? DEFAULT_RATING,
            note: entry?.note ?? '',
            touched: Boolean(entry),
          }
        }),
    }))
    .filter((section) => section.items.length > 0)

  const all = sections.flatMap((s) => s.items)
  const counts = Object.fromEntries(RATINGS.map((r) => [r, 0]))
  for (const item of all) counts[item.rating] += 1
  const touched = all.filter((i) => i.touched).length

  return {
    ...inspection,
    editable: isEditable(inspection),
    unit_name: unit?.name ?? '',
    unit_code: unit?.code ?? '',
    inspector_name: inspector?.full_name ?? '',
    template_version: template.version,
    signatures: signatures.map((s) => ({
      role: s.role,
      signed_name: s.signed_name,
      signed_at: s.signed_at,
      image: s.image,
    })),
    sections,
    summary_counts: {
      ...counts,
      total: all.length,
      touched,
      // Items nobody opened. Surfaced at sign-off so an inspection cannot quietly
      // assert hundreds of passing checks that were never looked at.
      untouched: all.length - touched,
      exceptions: all.filter((i) => isException(i.rating)).length,
    },
  }
}

/**
 * Apply autosaved changes. Storing a default rating with no note removes the row,
 * so undoing a mistake returns the item to genuinely untouched rather than leaving
 * it recorded as an explicit pass.
 *
 * Every change in one batch: an autosave either lands whole or not at all, so a
 * dropped connection mid-save cannot leave half an inspector's findings recorded.
 */
export async function applyItems(db, inspectionId, items) {
  const valid = new Set(
    await db.pluck(
      `SELECT ti.id FROM unit_template_items ti
       JOIN inspections i ON i.template_id = ti.template_id
       WHERE i.id = @id`,
      { id: inspectionId }
    )
  )

  const stray = items.find((i) => !valid.has(i.template_item_id))
  if (stray) {
    return { error: `Item ${stray.template_item_id} is not part of this inspection`, status: 422 }
  }

  const at = now()
  const statements = items.map((item) => {
    const note = (item.note ?? '').trim()
    if (item.rating === DEFAULT_RATING && note === '') {
      return db.stmt('DELETE FROM inspection_items WHERE inspection_id = @i AND template_item_id = @t', {
        i: inspectionId,
        t: item.template_item_id,
      })
    }
    return db.stmt(
      `INSERT INTO inspection_items (inspection_id, template_item_id, rating, note, updated_at)
       VALUES (@inspection_id, @template_item_id, @rating, @note, @updated_at)
       ON CONFLICT(inspection_id, template_item_id)
       DO UPDATE SET rating = excluded.rating, note = excluded.note, updated_at = excluded.updated_at`,
      {
        inspection_id: inspectionId,
        template_item_id: item.template_item_id,
        rating: item.rating,
        note,
        updated_at: at,
      }
    )
  })

  statements.push(db.stmt('UPDATE inspections SET updated_at = @at WHERE id = @id', { at, id: inspectionId }))
  await db.batch(statements)
  return { ok: true }
}
