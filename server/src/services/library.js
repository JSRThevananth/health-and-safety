import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDb } from '../db/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY_FILE = path.join(here, '..', 'db', 'library', 'checklist-v1.json')

/** Load the master checklist shipped with the app. */
export function readLibraryFile() {
  return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'))
}

/**
 * Install the master checklist for a tenant. Idempotent: existing items are matched
 * by code and left alone, so re-running never duplicates or overwrites local edits.
 */
export function installLibrary(tenantId, library = readLibraryFile()) {
  const db = getDb()
  let sections = 0
  let groups = 0
  let items = 0

  const install = db.transaction(() => {
    const findSection = db.prepare('SELECT id FROM library_sections WHERE tenant_id = ? AND code = ?')
    const addSection = db.prepare(
      'INSERT INTO library_sections (tenant_id, code, title, applies_to, sort_order) VALUES (?, ?, ?, ?, ?)'
    )
    const findGroup = db.prepare('SELECT id FROM library_groups WHERE section_id = ? AND code = ?')
    const addGroup = db.prepare(
      'INSERT INTO library_groups (section_id, code, title, sort_order) VALUES (?, ?, ?, ?)'
    )
    const findItem = db.prepare('SELECT id FROM library_items WHERE group_id = ? AND code = ?')
    const addItem = db.prepare(
      'INSERT INTO library_items (group_id, code, text, sort_order) VALUES (?, ?, ?, ?)'
    )

    for (const [sIdx, section] of library.sections.entries()) {
      let sectionId = findSection.get(tenantId, section.code)?.id
      if (!sectionId) {
        sectionId = Number(
          addSection.run(tenantId, section.code, section.title, section.applies_to, sIdx).lastInsertRowid
        )
        sections += 1
      }

      for (const [gIdx, group] of section.groups.entries()) {
        let groupId = findGroup.get(sectionId, group.code)?.id
        if (!groupId) {
          groupId = Number(addGroup.run(sectionId, group.code, group.title, gIdx).lastInsertRowid)
          groups += 1
        }

        for (const [iIdx, item] of group.items.entries()) {
          if (findItem.get(groupId, item.code)) continue
          addItem.run(groupId, item.code, item.text, iIdx)
          items += 1
        }
      }
    }
  })

  install()
  return { sections, groups, items }
}

/** The full library for a tenant, nested for the form editor UI. */
export function getLibrary(tenantId) {
  const db = getDb()
  const sections = db
    .prepare('SELECT * FROM library_sections WHERE tenant_id = ? ORDER BY sort_order')
    .all(tenantId)

  return sections.map((section) => ({
    ...section,
    groups: db
      .prepare('SELECT * FROM library_groups WHERE section_id = ? ORDER BY sort_order')
      .all(section.id)
      .map((group) => ({
        ...group,
        items: db
          .prepare('SELECT * FROM library_items WHERE group_id = ? AND active = 1 ORDER BY sort_order')
          .all(group.id),
      })),
  }))
}
