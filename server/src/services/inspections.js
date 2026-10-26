import { getDb } from '../db/index.js'
import { getPublishedTemplate, resolveTemplate } from './formTemplates.js'

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
export function openDraft(unitId, inspectorId) {
  const db = getDb()

  const existing = db
    .prepare(`SELECT * FROM inspections WHERE unit_id = ? AND inspector_id = ? AND status = 'draft'`)
    .get(unitId, inspectorId)
  if (existing) return { inspection: existing, created: false }

  const template = getPublishedTemplate(unitId)
  if (!template) return { error: 'This unit has no published checklist yet', status: 409 }

  const id = Number(
    db
      .prepare('INSERT INTO inspections (unit_id, template_id, inspector_id) VALUES (?, ?, ?)')
      .run(unitId, template.id, inspectorId).lastInsertRowid
  )
  return { inspection: db.prepare('SELECT * FROM inspections WHERE id = ?').get(id), created: true }
}

/**
 * Merge the pinned template with the stored deviations into the full record.
 * Items with no stored row are satisfactory and untouched - which is how the
 * "accepted at default" count is derived rather than stored.
 */
export function resolveInspection(inspectionId) {
  const db = getDb()
  const inspection = db.prepare('SELECT * FROM inspections WHERE id = ?').get(inspectionId)
  if (!inspection) return null

  const template = resolveTemplate(inspection.template_id)
  const stored = new Map(
    db
      .prepare('SELECT * FROM inspection_items WHERE inspection_id = ?')
      .all(inspectionId)
      .map((row) => [row.template_item_id, row])
  )

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

  const inspector = db
    .prepare('SELECT full_name, initials FROM users WHERE id = ?')
    .get(inspection.inspector_id)
  const unit = db.prepare('SELECT name, code FROM units WHERE id = ?').get(inspection.unit_id)

  return {
    ...inspection,
    editable: isEditable(inspection),
    unit_name: unit?.name ?? '',
    unit_code: unit?.code ?? '',
    inspector_name: inspector?.full_name ?? '',
    template_version: template.version,
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
 */
export function applyItems(inspectionId, items) {
  const db = getDb()

  const valid = new Set(
    db
      .prepare(
        `SELECT ti.id FROM unit_template_items ti
         JOIN inspections i ON i.template_id = ti.template_id
         WHERE i.id = ?`
      )
      .all(inspectionId)
      .map((r) => r.id)
  )

  const stray = items.find((i) => !valid.has(i.template_item_id))
  if (stray) {
    return { error: `Item ${stray.template_item_id} is not part of this inspection`, status: 422 }
  }

  const upsert = db.prepare(
    `INSERT INTO inspection_items (inspection_id, template_item_id, rating, note, updated_at)
     VALUES (@inspection_id, @template_item_id, @rating, @note, datetime('now'))
     ON CONFLICT(inspection_id, template_item_id)
     DO UPDATE SET rating = excluded.rating, note = excluded.note, updated_at = excluded.updated_at`
  )
  const remove = db.prepare(
    'DELETE FROM inspection_items WHERE inspection_id = ? AND template_item_id = ?'
  )

  db.transaction(() => {
    for (const item of items) {
      const note = (item.note ?? '').trim()
      if (item.rating === DEFAULT_RATING && note === '') {
        remove.run(inspectionId, item.template_item_id)
      } else {
        upsert.run({ inspection_id: inspectionId, template_item_id: item.template_item_id, rating: item.rating, note })
      }
    }
    db.prepare(`UPDATE inspections SET updated_at = datetime('now') WHERE id = ?`).run(inspectionId)
  })()

  return { ok: true }
}
