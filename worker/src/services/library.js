import library from '../library/checklist-v1.js'

/**
 * The master checklist, shared across every unit.
 *
 * The Node build read this from disk at runtime. A Worker has no filesystem, so the
 * JSON is imported and bundled into the script - which also means it cannot go
 * missing in production the way a file left out of a deploy can.
 */
export const readLibraryFile = () => library

/**
 * Install the master checklist for a tenant. Idempotent: existing rows are
 * matched by code and left alone, so re-running never duplicates or overwrites
 * local edits.
 *
 * Written as eight queries rather than one per row, because of a platform limit
 * that is easy to miss: a Worker may make 50 subrequests per request on the
 * free plan, and every D1 query is a subrequest. The obvious shape - look up
 * each section, then each group, then each item - comes to about 140 calls for
 * this library and fails outright. Reading a whole level at once and inserting
 * the missing rows in one batch brings it to eight, whatever the library's size.
 */
export async function installLibrary(db, tenantId, source = library) {
  /* ---- sections ---- */
  const existingSections = await db.all(
    'SELECT id, code FROM library_sections WHERE tenant_id = @t',
    { t: tenantId }
  )
  const sectionIdByCode = new Map(existingSections.map((r) => [r.code, r.id]))

  const newSections = source.sections
    .map((section, index) => ({
      tenant_id: tenantId,
      code: section.code,
      title: section.title,
      applies_to: section.applies_to,
      sort_order: index,
    }))
    .filter((row) => !sectionIdByCode.has(row.code))

  if (newSections.length) {
    await db.batch(
      db.bulkInsert(
        'library_sections',
        ['tenant_id', 'code', 'title', 'applies_to', 'sort_order'],
        newSections
      )
    )
    for (const row of await db.all('SELECT id, code FROM library_sections WHERE tenant_id = @t', {
      t: tenantId,
    })) {
      sectionIdByCode.set(row.code, row.id)
    }
  }

  /* ---- groups ---- */
  const sectionIds = db.idList([...sectionIdByCode.values()])
  const existingGroups = await db.all(
    `SELECT id, code, section_id FROM library_groups WHERE section_id IN (${sectionIds})`
  )
  // Group codes repeat across sections, so the key has to carry both.
  const groupKey = (sectionId, code) => `${sectionId}:${code}`
  const groupIdByKey = new Map(existingGroups.map((r) => [groupKey(r.section_id, r.code), r.id]))

  const newGroups = source.sections
    .flatMap((section) =>
      section.groups.map((group, index) => ({
        section_id: sectionIdByCode.get(section.code),
        code: group.code,
        title: group.title,
        sort_order: index,
      }))
    )
    .filter((row) => !groupIdByKey.has(groupKey(row.section_id, row.code)))

  if (newGroups.length) {
    await db.batch(
      db.bulkInsert('library_groups', ['section_id', 'code', 'title', 'sort_order'], newGroups)
    )
    for (const row of await db.all(
      `SELECT id, code, section_id FROM library_groups WHERE section_id IN (${sectionIds})`
    )) {
      groupIdByKey.set(groupKey(row.section_id, row.code), row.id)
    }
  }

  /* ---- items ---- */
  const groupIds = db.idList([...groupIdByKey.values()])
  const existingItems = groupIds === 'NULL'
    ? []
    : await db.all(`SELECT group_id, code FROM library_items WHERE group_id IN (${groupIds})`)
  const seen = new Set(existingItems.map((r) => `${r.group_id}:${r.code}`))

  const newItems = source.sections
    .flatMap((section) =>
      section.groups.flatMap((group) => {
        const groupId = groupIdByKey.get(groupKey(sectionIdByCode.get(section.code), group.code))
        return group.items.map((item, index) => ({
          group_id: groupId,
          code: item.code,
          text: item.text,
          sort_order: index,
        }))
      })
    )
    .filter((row) => row.group_id && !seen.has(`${row.group_id}:${row.code}`))

  if (newItems.length) {
    await db.batch(
      db.bulkInsert('library_items', ['group_id', 'code', 'text', 'sort_order'], newItems)
    )
  }

  return { sections: newSections.length, groups: newGroups.length, items: newItems.length }
}

/**
 * The full library for a tenant, nested for the form editor UI.
 *
 * Read as three flat queries and assembled in memory rather than a query per group.
 * The Node build's nested loop issued ~90 queries against a local file, which cost
 * nothing; against D1 each one is a network round trip.
 */
export async function getLibrary(db, tenantId) {
  const sections = await db.all(
    'SELECT * FROM library_sections WHERE tenant_id = @t ORDER BY sort_order',
    { t: tenantId }
  )
  if (sections.length === 0) return []

  const sectionIds = db.idList(sections.map((s) => s.id))
  const groups = await db.all(
    `SELECT * FROM library_groups WHERE section_id IN (${sectionIds}) ORDER BY sort_order`
  )
  const items = groups.length
    ? await db.all(
        `SELECT * FROM library_items
         WHERE group_id IN (${db.idList(groups.map((g) => g.id))}) AND active = 1
         ORDER BY sort_order`
      )
    : []

  const itemsByGroup = new Map()
  for (const item of items) {
    if (!itemsByGroup.has(item.group_id)) itemsByGroup.set(item.group_id, [])
    itemsByGroup.get(item.group_id).push(item)
  }

  return sections.map((section) => ({
    ...section,
    groups: groups
      .filter((g) => g.section_id === section.id)
      .map((group) => ({ ...group, items: itemsByGroup.get(group.id) || [] })),
  }))
}
