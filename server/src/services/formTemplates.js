import { getDb } from '../db/index.js'

/**
 * Per-unit checklist versions.
 *
 * The rules that matter:
 *  - A published version is immutable. Edits always go to a draft.
 *  - Publishing archives the previous published version rather than replacing it, so an
 *    inspection signed months ago still renders exactly as it was filled in.
 *  - A reworded item keeps its library_item_id, which is what preserves cross-unit
 *    comparison and repeat-finding detection.
 */

export function getPublishedTemplate(unitId) {
  return getDb()
    .prepare(`SELECT * FROM unit_templates WHERE unit_id = ? AND status = 'published'`)
    .get(unitId)
}

export function getDraftTemplate(unitId) {
  return getDb()
    .prepare(`SELECT * FROM unit_templates WHERE unit_id = ? AND status = 'draft'`)
    .get(unitId)
}

function nextVersion(db, unitId) {
  const row = db.prepare('SELECT MAX(version) AS v FROM unit_templates WHERE unit_id = ?').get(unitId)
  return (row.v || 0) + 1
}

/**
 * Open a draft for a unit. Seeds from the unit's published version when one exists,
 * otherwise from the tenant library with every item enabled.
 */
export function createDraft(unitId, tenantId, userId) {
  const db = getDb()

  const existing = getDraftTemplate(unitId)
  if (existing) return existing

  const create = db.transaction(() => {
    const templateId = Number(
      db
        .prepare('INSERT INTO unit_templates (unit_id, version, status, created_by) VALUES (?, ?, ?, ?)')
        .run(unitId, nextVersion(db, unitId), 'draft', userId).lastInsertRowid
    )

    const published = getPublishedTemplate(unitId)
    const addSection = db.prepare(
      'INSERT INTO unit_template_sections (template_id, section_id, enabled, sort_order) VALUES (?, ?, ?, ?)'
    )
    const addItem = db.prepare(
      `INSERT INTO unit_template_items
         (template_id, library_item_id, custom_item_id, text_override, enabled, risk_weight, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    if (published) {
      // Carry forward the unit's current customisation verbatim.
      for (const s of db
        .prepare('SELECT * FROM unit_template_sections WHERE template_id = ?')
        .all(published.id)) {
        addSection.run(templateId, s.section_id, s.enabled, s.sort_order)
      }
      for (const i of db
        .prepare('SELECT * FROM unit_template_items WHERE template_id = ? ORDER BY sort_order')
        .all(published.id)) {
        addItem.run(
          templateId, i.library_item_id, i.custom_item_id, i.text_override,
          i.enabled, i.risk_weight, i.sort_order
        )
      }
    } else {
      // First draft: the whole library, everything enabled.
      const sections = db
        .prepare('SELECT * FROM library_sections WHERE tenant_id = ? ORDER BY sort_order')
        .all(tenantId)
      let order = 0
      for (const section of sections) {
        addSection.run(templateId, section.id, 1, section.sort_order)
        const items = db
          .prepare(
            `SELECT i.* FROM library_items i
             JOIN library_groups g ON g.id = i.group_id
             WHERE g.section_id = ? AND i.active = 1
             ORDER BY g.sort_order, i.sort_order`
          )
          .all(section.id)
        for (const item of items) addItem.run(templateId, item.id, null, null, 1, null, order++)
      }
    }

    return templateId
  })

  const id = create()
  return db.prepare('SELECT * FROM unit_templates WHERE id = ?').get(id)
}

/**
 * Resolve a template into the nested shape the editor and the inspection form render.
 * `text` is the effective wording; `reworded` flags items whose text differs from the
 * library, so a cross-unit report can warn that the comparison is not like-for-like.
 */
export function resolveTemplate(templateId) {
  const db = getDb()
  const template = db.prepare('SELECT * FROM unit_templates WHERE id = ?').get(templateId)
  if (!template) return null

  const rows = db
    .prepare(
      `SELECT ti.id, ti.library_item_id, ti.custom_item_id, ti.text_override, ti.enabled,
              ti.sort_order, COALESCE(ti.risk_weight, li.risk_weight, ci.risk_weight, 1) AS risk_weight,
              li.code AS library_code, li.text AS library_text,
              ci.text AS custom_text,
              COALESCE(lg.section_id, ci.section_id) AS section_id,
              lg.title AS group_title, lg.code AS group_code
       FROM unit_template_items ti
       LEFT JOIN library_items li ON li.id = ti.library_item_id
       LEFT JOIN library_groups lg ON lg.id = li.group_id
       LEFT JOIN unit_custom_items ci ON ci.id = ti.custom_item_id
       WHERE ti.template_id = ?
       ORDER BY ti.sort_order`
    )
    .all(templateId)

  const sectionRows = db
    .prepare(
      `SELECT ts.section_id, ts.enabled, ts.sort_order, s.code, s.title, s.applies_to
       FROM unit_template_sections ts
       JOIN library_sections s ON s.id = ts.section_id
       WHERE ts.template_id = ?
       ORDER BY ts.sort_order`
    )
    .all(templateId)

  const sections = sectionRows.map((s) => ({
    section_id: s.section_id,
    code: s.code,
    title: s.title,
    applies_to: s.applies_to,
    enabled: Boolean(s.enabled),
    items: rows
      .filter((r) => r.section_id === s.section_id)
      .map((r) => ({
        id: r.id,
        library_item_id: r.library_item_id,
        custom_item_id: r.custom_item_id,
        code: r.library_code || `CUSTOM.${r.custom_item_id}`,
        group_code: r.group_code,
        group_title: r.group_title || '',
        text: r.text_override ?? r.library_text ?? r.custom_text,
        reworded: Boolean(r.text_override),
        is_custom: r.custom_item_id !== null,
        enabled: Boolean(r.enabled),
        risk_weight: r.risk_weight,
        sort_order: r.sort_order,
      })),
  }))

  const allItems = sections.flatMap((s) => s.items)
  // An item only appears on an inspection when both it and its section are enabled;
  // counting the item flag alone would overstate the length of the form.
  const effective = sections.filter((s) => s.enabled).flatMap((s) => s.items.filter((i) => i.enabled))

  return {
    ...template,
    sections,
    stats: {
      sections_total: sections.length,
      sections_enabled: sections.filter((s) => s.enabled).length,
      items_total: allItems.length,
      items_enabled: allItems.filter((i) => i.enabled).length,
      // What an inspector will actually be asked - the number that matters.
      items_effective: effective.length,
      items_custom: allItems.filter((i) => i.is_custom).length,
      items_reworded: allItems.filter((i) => i.reworded).length,
    },
  }
}

/** Publish a draft, archiving whatever was published before it. */
export function publishDraft(templateId) {
  const db = getDb()
  const draft = db.prepare('SELECT * FROM unit_templates WHERE id = ?').get(templateId)
  if (!draft) return { error: 'Template not found', status: 404 }
  if (draft.status !== 'draft') return { error: 'Only a draft can be published', status: 409 }

  // Count only items whose section is also enabled - that is what an inspector sees.
  const enabled = resolveTemplate(templateId).stats.items_effective
  if (enabled === 0) return { error: 'Cannot publish a checklist with no enabled items', status: 422 }

  db.transaction(() => {
    db.prepare(`UPDATE unit_templates SET status = 'archived' WHERE unit_id = ? AND status = 'published'`)
      .run(draft.unit_id)
    db.prepare(`UPDATE unit_templates SET status = 'published', published_at = datetime('now') WHERE id = ?`)
      .run(templateId)
  })()

  return { template: db.prepare('SELECT * FROM unit_templates WHERE id = ?').get(templateId) }
}
