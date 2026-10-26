import { now } from '../db.js'

/**
 * Per-unit checklist versions.
 *
 * The rules that matter:
 *  - A published version is immutable. Edits always go to a draft.
 *  - Publishing archives the previous published version rather than replacing it, so
 *    an inspection signed months ago still renders exactly as it was filled in.
 *  - A reworded item keeps its library_item_id, which is what preserves cross-unit
 *    comparison and repeat-finding detection.
 */

export const getPublishedTemplate = (db, unitId) =>
  db.get(`SELECT * FROM unit_templates WHERE unit_id = @u AND status = 'published'`, { u: unitId })

export const getDraftTemplate = (db, unitId) =>
  db.get(`SELECT * FROM unit_templates WHERE unit_id = @u AND status = 'draft'`, { u: unitId })

async function nextVersion(db, unitId) {
  const row = await db.get('SELECT MAX(version) AS v FROM unit_templates WHERE unit_id = @u', { u: unitId })
  return (row?.v || 0) + 1
}

const SECTION_COLUMNS = ['template_id', 'section_id', 'enabled', 'sort_order']
const ITEM_COLUMNS = [
  'template_id',
  'library_item_id',
  'custom_item_id',
  'text_override',
  'enabled',
  'risk_weight',
  'sort_order',
]

/**
 * Open a draft for a unit. Seeds from the unit's published version when one exists,
 * otherwise from the tenant library with every item enabled.
 *
 * The parent row has to exist before its ~300 children can reference it, and D1 has
 * no transaction that can span the two awaits. So the children go in as one atomic
 * batch and the parent is deleted if that batch fails - leaving no half-built draft
 * for an inspector to open.
 */
export async function createDraft(db, unitId, tenantId, userId) {
  const existing = await getDraftTemplate(db, unitId)
  if (existing) return existing

  const { id: templateId } = await db.insert(
    `INSERT INTO unit_templates (unit_id, version, status, created_by)
     VALUES (@unit_id, @version, 'draft', @created_by)`,
    { unit_id: unitId, version: await nextVersion(db, unitId), created_by: userId }
  )

  try {
    const published = await getPublishedTemplate(db, unitId)
    const { sections, items } = published
      ? await copyOf(db, templateId, published.id)
      : await seedFromLibrary(db, templateId, tenantId)

    await db.batch([
      ...db.bulkInsert('unit_template_sections', SECTION_COLUMNS, sections),
      ...db.bulkInsert('unit_template_items', ITEM_COLUMNS, items),
    ])
  } catch (error) {
    await db.run('DELETE FROM unit_templates WHERE id = @id', { id: templateId })
    throw error
  }

  return db.get('SELECT * FROM unit_templates WHERE id = @id', { id: templateId })
}

/** Carry the unit's current customisation forward verbatim. */
async function copyOf(db, templateId, sourceId) {
  const sections = (
    await db.all('SELECT * FROM unit_template_sections WHERE template_id = @t', { t: sourceId })
  ).map((s) => ({
    template_id: templateId,
    section_id: s.section_id,
    enabled: s.enabled,
    sort_order: s.sort_order,
  }))

  const items = (
    await db.all('SELECT * FROM unit_template_items WHERE template_id = @t ORDER BY sort_order', {
      t: sourceId,
    })
  ).map((i) => ({
    template_id: templateId,
    library_item_id: i.library_item_id,
    custom_item_id: i.custom_item_id,
    text_override: i.text_override,
    enabled: i.enabled,
    risk_weight: i.risk_weight,
    sort_order: i.sort_order,
  }))

  return { sections, items }
}

/** A unit's first draft: the whole library, everything enabled. */
async function seedFromLibrary(db, templateId, tenantId) {
  const librarySections = await db.all(
    'SELECT * FROM library_sections WHERE tenant_id = @t ORDER BY sort_order',
    { t: tenantId }
  )
  if (librarySections.length === 0) return { sections: [], items: [] }

  // One query for every item in the tenant rather than one per section: against D1
  // each query is a round trip, and sixteen of them is a visible pause on a phone.
  const libraryItems = await db.all(
    `SELECT i.id, g.section_id, g.sort_order AS group_order, i.sort_order
     FROM library_items i
     JOIN library_groups g ON g.id = i.group_id
     WHERE g.section_id IN (${db.idList(librarySections.map((s) => s.id))}) AND i.active = 1
     ORDER BY g.section_id, g.sort_order, i.sort_order`
  )

  const sections = librarySections.map((s) => ({
    template_id: templateId,
    section_id: s.id,
    enabled: 1,
    sort_order: s.sort_order,
  }))

  let order = 0
  const items = librarySections.flatMap((section) =>
    libraryItems
      .filter((i) => i.section_id === section.id)
      .map((i) => ({
        template_id: templateId,
        library_item_id: i.id,
        custom_item_id: null,
        text_override: null,
        enabled: 1,
        risk_weight: null,
        sort_order: order++,
      }))
  )

  return { sections, items }
}

/**
 * Resolve a template into the nested shape the editor and the inspection form render.
 * `text` is the effective wording; `reworded` flags items whose text differs from the
 * library, so a cross-unit report can warn that the comparison is not like-for-like.
 */
export async function resolveTemplate(db, templateId) {
  const template = await db.get('SELECT * FROM unit_templates WHERE id = @id', { id: templateId })
  if (!template) return null

  const rows = await db.all(
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
     WHERE ti.template_id = @t
     ORDER BY ti.sort_order`,
    { t: templateId }
  )

  const sectionRows = await db.all(
    `SELECT ts.section_id, ts.enabled, ts.sort_order, s.code, s.title, s.applies_to
     FROM unit_template_sections ts
     JOIN library_sections s ON s.id = ts.section_id
     WHERE ts.template_id = @t
     ORDER BY ts.sort_order`,
    { t: templateId }
  )

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
export async function publishDraft(db, templateId) {
  const draft = await db.get('SELECT * FROM unit_templates WHERE id = @id', { id: templateId })
  if (!draft) return { error: 'Template not found', status: 404 }
  if (draft.status !== 'draft') return { error: 'Only a draft can be published', status: 409 }

  // Count only items whose section is also enabled - that is what an inspector sees.
  const { items_effective: enabled } = (await resolveTemplate(db, templateId)).stats
  if (enabled === 0) return { error: 'Cannot publish a checklist with no enabled items', status: 422 }

  // One batch, so there is never a moment with two published versions or none.
  await db.batch([
    db.stmt(`UPDATE unit_templates SET status = 'archived' WHERE unit_id = @u AND status = 'published'`, {
      u: draft.unit_id,
    }),
    db.stmt(`UPDATE unit_templates SET status = 'published', published_at = @at WHERE id = @id`, {
      at: now(),
      id: templateId,
    }),
  ])

  return { template: await db.get('SELECT * FROM unit_templates WHERE id = @id', { id: templateId }) }
}
