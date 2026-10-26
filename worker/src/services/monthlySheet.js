import { now } from '../db.js'
import { driveAccessToken } from './storage.js'

/**
 * The monthly spreadsheet in Drive.
 *
 * Auditors and quality managers want a spreadsheet; they are not going to learn
 * this app to sort a column. So they get one - but as a *generated view* of the
 * database, rebuilt from scratch each night, never as the place the data lives.
 *
 * That distinction is the whole design. A spreadsheet has no constraints, no
 * transactions and no audit trail: two inspectors submitting at once would
 * silently overwrite each other's row, anyone with the link could retype a
 * rating, and nothing would record that it happened. For a food-safety record
 * that may be read back in a dispute, those are exactly the properties you
 * cannot give up. D1 keeps them. The sheet is a convenience on top, and because
 * it is rebuilt rather than appended to, it cannot drift from the truth.
 *
 * One row per recorded finding, because that is the grain people filter and
 * pivot on. An inspection with nothing flagged still gets a row, so it appears
 * in the month rather than vanishing for having gone well.
 */

/**
 * How many unit-months one nightly run will rebuild.
 *
 * The cron shares a 50-subrequest budget with the photo purge. Each sheet costs
 * one query and one Drive write, plus one token exchange for the whole run, so
 * five is comfortable. More units than this rotate: the query orders by least
 * recently built, so nothing is starved, it just takes a few nights to come
 * round.
 */
export const MAX_UNITS_PER_RUN = 5

export const COLUMNS = [
  'Inspection',
  'Date',
  'Unit',
  'Unit code',
  'Status',
  'Inspector',
  'Department',
  'Shift',
  'Section',
  'Group',
  'Item',
  'Rating',
  'Note',
  'Risk weight',
  'Photos',
  'Photos purged',
  'Inspector signature',
  'Signed at',
  'Supervisor signature',
  'Countersigned at',
  'Summary',
]

/** The month a date falls in, as the YYYY-MM these files are keyed by. */
export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7)

/** Half-open [from, to): the range a month covers, in the stored timestamp format. */
export function monthRange(period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error(`Not a month: ${period}`)
  const [year, month] = period.split('-').map(Number)
  const from = new Date(Date.UTC(year, month - 1, 1))
  const to = new Date(Date.UTC(year, month, 1))
  return { from: stamp(from), to: stamp(to) }
}

export function previousMonth(period) {
  const [year, month] = period.split('-').map(Number)
  return monthKey(new Date(Date.UTC(year, month - 2, 1)))
}

const stamp = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Every recorded finding in the month, with its inspection around it.
 *
 * A LEFT JOIN onto the items, so an inspection where nothing was flagged still
 * produces its one row. Only items an inspector actually touched are stored -
 * everything else is satisfactory by definition - so this is the findings list,
 * not 303 rows of "fine" per visit.
 *
 * The counts hanging off each inspection are correlated subqueries rather than
 * extra round trips: on a Worker, a second query costs a subrequest, and the
 * budget is 50 for the whole invocation.
 */
export async function collectRows(db, unitId, period) {
  const { from, to } = monthRange(period)

  return db.all(
    `SELECT
       i.id                AS inspection_id,
       COALESCE(i.submitted_at, i.started_at) AS occurred_at,
       u.name              AS unit_name,
       u.code              AS unit_code,
       i.status            AS status,
       insp.full_name      AS inspector_name,
       i.department        AS department,
       i.shift             AS shift,
       i.summary           AS summary,
       sec.title           AS section_title,
       grp.title           AS group_title,
       COALESCE(ti.text_override, li.text, ci.text) AS item_text,
       it.rating           AS rating,
       it.note             AS note,
       COALESCE(ti.risk_weight, li.risk_weight, ci.risk_weight) AS risk_weight,
       (SELECT COUNT(*) FROM attachments a
         WHERE a.entity_type = 'inspection' AND a.entity_id = i.id) AS photo_count,
       (SELECT COUNT(*) FROM attachments a
         WHERE a.entity_type = 'inspection' AND a.entity_id = i.id
           AND a.purged_at IS NOT NULL) AS photos_purged,
       (SELECT s.signed_name FROM inspection_signatures s
         WHERE s.inspection_id = i.id AND s.role = 'inspector') AS inspector_signature,
       (SELECT s.signed_at FROM inspection_signatures s
         WHERE s.inspection_id = i.id AND s.role = 'inspector') AS inspector_signed_at,
       (SELECT s.signed_name FROM inspection_signatures s
         WHERE s.inspection_id = i.id AND s.role = 'supervisor') AS supervisor_signature,
       (SELECT s.signed_at FROM inspection_signatures s
         WHERE s.inspection_id = i.id AND s.role = 'supervisor') AS supervisor_signed_at
     FROM inspections i
     JOIN units u ON u.id = i.unit_id
     JOIN users insp ON insp.id = i.inspector_id
     LEFT JOIN inspection_items it ON it.inspection_id = i.id
     LEFT JOIN unit_template_items ti ON ti.id = it.template_item_id
     LEFT JOIN library_items li ON li.id = ti.library_item_id
     LEFT JOIN library_groups grp ON grp.id = li.group_id
     LEFT JOIN unit_custom_items ci ON ci.id = ti.custom_item_id
     LEFT JOIN library_sections sec ON sec.id = COALESCE(grp.section_id, ci.section_id)
     WHERE i.unit_id = @unit
       AND i.status IN ('submitted', 'signed')
       AND COALESCE(i.submitted_at, i.started_at) >= @from
       AND COALESCE(i.submitted_at, i.started_at) < @to
     ORDER BY occurred_at, i.id, sec.sort_order, grp.sort_order, ti.sort_order`,
    { unit: unitId, from, to }
  )
}

/** One spreadsheet row per database row, in the order COLUMNS declares. */
export function toGrid(rows) {
  return rows.map((row) => [
    row.inspection_id,
    (row.occurred_at || '').slice(0, 10),
    row.unit_name,
    row.unit_code,
    row.status,
    row.inspector_name,
    row.department,
    row.shift,
    row.section_title || '',
    row.group_title || '',
    row.item_text || '',
    // No item means nothing was flagged. Say so, rather than leaving a blank
    // that reads as missing data.
    row.rating || 'no exceptions recorded',
    row.note || '',
    row.risk_weight ?? '',
    row.photo_count ?? 0,
    row.photos_purged ?? 0,
    row.inspector_signature || '',
    row.inspector_signed_at || '',
    row.supervisor_signature || '',
    row.supervisor_signed_at || '',
    row.summary || '',
  ])
}

export function toCsv(rows) {
  const lines = [COLUMNS, ...toGrid(rows)].map((row) => row.map(cell).join(','))
  // A byte order mark, so Excel opens it as UTF-8 rather than mangling accented
  // names and degree signs.
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * One CSV cell.
 *
 * The leading apostrophe is not decoration. A note beginning = + - or @ is a
 * formula to Excel and to Sheets, so a finding typed as "=cmd|..." becomes code
 * the moment a manager opens the file. Inspectors type free text into these
 * fields; the apostrophe makes the spreadsheet treat all of it as text.
 */
function cell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Rebuild one unit's sheet for one month and leave it in Drive.
 *
 * Returns what happened rather than throwing on a missing configuration: the
 * nightly run must carry on to the next unit, and a Worker with no Drive
 * credentials is a normal state (Phase 1 of the setup), not a fault.
 */
export async function buildMonthlySheet(env, config, db, { unitId, period = monthKey() }) {
  if (config.storage.backend !== 'drive') {
    return { skipped: 'storage backend is not Drive', unitId, period }
  }

  const unit = await db.get('SELECT id, name, code FROM units WHERE id = @id', { id: unitId })
  if (!unit) return { skipped: 'no such unit', unitId, period }

  const rows = await collectRows(db, unitId, period)
  const existing = await db.get(
    'SELECT file_id FROM unit_month_exports WHERE unit_id = @u AND period = @p',
    { u: unitId, p: period }
  )

  const written = await writeSheet(config, {
    fileId: existing?.file_id || '',
    name: `Inspections ${unit.code} ${period}`,
    csv: toCsv(rows),
  })

  await db.run(
    `INSERT INTO unit_month_exports (unit_id, period, file_id, web_view_link, row_count, built_at)
     VALUES (@unit, @period, @file, @link, @rows, @at)
     ON CONFLICT(unit_id, period) DO UPDATE SET
       file_id = excluded.file_id,
       web_view_link = excluded.web_view_link,
       row_count = excluded.row_count,
       built_at = excluded.built_at`,
    {
      unit: unitId,
      period,
      file: written.id,
      link: written.webViewLink || '',
      rows: rows.length,
      at: now(),
    }
  )

  return { unitId, period, rows: rows.length, fileId: written.id, link: written.webViewLink || '' }
}

/**
 * Put the CSV into Drive as a Google Sheet.
 *
 * Created with Drive's own conversion - upload CSV, ask for a Sheet - so what
 * lands is a real spreadsheet someone can sort and pivot, not an attachment they
 * have to import first. Updates replace the content of that same file, which is
 * what keeps a link to "this month" valid all month.
 */
async function writeSheet(config, { fileId, name, csv }) {
  const token = await driveAccessToken(config)

  if (fileId) {
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,webViewLink`,
      {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'text/csv' },
        body: csv,
      }
    )
    if (response.ok) return response.json()

    // Somebody deleted it, or it was never ours. Fall through and make a new
    // one rather than failing every night from here on.
    if (response.status !== 404 && response.status !== 403) {
      throw new Error(`Drive refused the sheet update: ${await response.text()}`)
    }
  }

  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    ...(config.storage.driveFolderId ? { parents: [config.storage.driveFolderId] } : {}),
  }
  const boundary = `sheet${Math.random().toString(36).slice(2)}`
  const body = [
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\ncontent-type: text/csv\r\n\r\n`,
    csv,
    `\r\n--${boundary}--\r\n`,
  ].join('')

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )
  if (!response.ok) throw new Error(`Drive refused the new sheet: ${await response.text()}`)
  return response.json()
}

/**
 * The nightly sweep: this month for every active unit, and last month too for
 * the first couple of days, so late submissions still land in the month they
 * belong to before the file is left alone for good.
 */
export async function rebuildMonthlySheets(env, config, db, { at = new Date(), limit = MAX_UNITS_PER_RUN } = {}) {
  const report = { built: 0, failed: 0, rows: 0, skipped: '' }
  if (config.storage.backend !== 'drive') {
    report.skipped = 'storage backend is not Drive'
    return report
  }

  const current = monthKey(at)
  const periods = at.getUTCDate() <= 2 ? [current, previousMonth(current)] : [current]

  // Least recently built first, so a tenant with more units than the budget
  // allows gets every one of them over successive nights.
  const units = await db.all(
    `SELECT u.id,
            (SELECT MIN(e.built_at) FROM unit_month_exports e
              WHERE e.unit_id = u.id AND e.period IN (${periods.map((_, i) => `@p${i}`).join(', ')})
            ) AS oldest
     FROM units u
     WHERE u.active = 1
     ORDER BY oldest IS NOT NULL, oldest
     LIMIT @limit`,
    { ...Object.fromEntries(periods.map((p, i) => [`p${i}`, p])), limit }
  )

  for (const unit of units) {
    for (const period of periods) {
      try {
        const result = await buildMonthlySheet(env, config, db, { unitId: unit.id, period })
        if (result.skipped) continue
        report.built += 1
        report.rows += result.rows
      } catch (error) {
        // One unit's Drive problem must not stop the others, and tomorrow's run
        // tries again from the same database.
        console.error(`[sheets] unit ${unit.id} ${period}:`, error.message)
        report.failed += 1
      }
    }
  }

  return report
}
