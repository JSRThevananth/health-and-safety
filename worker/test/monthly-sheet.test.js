import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'
import { installFakeGoogle, restoreFetch, DRIVE_ENV } from './fake-google.js'
import { readConfig } from '../src/config.js'
import {
  buildMonthlySheet,
  collectRows,
  monthKey,
  monthRange,
  previousMonth,
  rebuildMonthlySheets,
  toCsv,
} from '../src/services/monthlySheet.js'

afterEach(restoreFetch)

/**
 * A unit with one submitted inspection in the current month, carrying one
 * critical finding. Drive-backed, so the sheet writer has somewhere to write.
 */
async function withInspection({ note = 'Fire door wedged open with a crate' } = {}) {
  const state = installFakeGoogle()
  const h = await createHarness({ env: DRIVE_ENV })
  const fixture = await seedFixture(h.db)

  const inspector = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: fixture.unitA } })
  ).body
  const item = draft.sections[0].items[0]

  await h.call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token: inspector,
    body: {
      department: 'Hot Kitchen',
      items: [{ template_item_id: item.id, rating: 'critical', note }],
    },
  })
  await signInspection(h.call, inspector, draft.id, 'LHR Inspector')
  await h.call(`/inspections/${draft.id}/submit`, { method: 'POST', token: inspector })

  return { ...h, ...fixture, state, inspector, draft, item, config: readConfig(h.bindings) }
}

const parse = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n')

/* ----------------------------------------------------------- the period -- */

test('a month is a half-open range, so nothing is counted twice', () => {
  assert.deepEqual(monthRange('2026-01'), { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' })
  // December rolls the year, which is where naive month arithmetic breaks.
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' })
  assert.equal(previousMonth('2026-01'), '2025-12')
  assert.throws(() => monthRange('2026-13'), /Not a month/)
  assert.throws(() => monthRange('nonsense'), /Not a month/)
})

/* ------------------------------------------------------------- the rows -- */

test('the sheet carries the findings, the signature and the photo count', async () => {
  const { db, unitA } = await withInspection()
  const rows = await collectRows(db, unitA, monthKey())

  assert.equal(rows.length, 1, 'one recorded finding, one row')
  const [row] = rows
  assert.equal(row.rating, 'critical')
  assert.equal(row.note, 'Fire door wedged open with a crate')
  assert.equal(row.unit_code, 'LHR')
  assert.equal(row.department, 'Hot Kitchen')
  assert.equal(row.inspector_signature, 'LHR Inspector')
  assert.ok(row.item_text, 'the item wording comes from the pinned template')
  assert.ok(row.section_title, 'and the section it sits in')
})

test('an inspection with nothing flagged still appears', async () => {
  const { db, call, unitA, inspector } = await withInspection()

  // A second inspection, submitted with no exceptions recorded at all.
  const second = (
    await call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: unitA } })
  ).body
  await signInspection(call, inspector, second.id, 'LHR Inspector')
  await call(`/inspections/${second.id}/submit`, { method: 'POST', token: inspector })

  const rows = await collectRows(db, unitA, monthKey())
  assert.equal(rows.length, 2)
  const blank = rows.find((r) => r.inspection_id === second.id)
  // A clean inspection is a result, not an absence: it has to be visible in the
  // month, or the sheet only ever shows bad news.
  assert.equal(blank.rating, null)
  assert.match(toCsv([blank]), /no exceptions recorded/)
})

test('another unit\'s inspections are not in this unit\'s sheet', async () => {
  const { db, unitB } = await withInspection()
  assert.deepEqual(await collectRows(db, unitB, monthKey()), [])
})

test('last month is not in this month', async () => {
  const { db, unitA } = await withInspection()
  assert.deepEqual(await collectRows(db, unitA, previousMonth(monthKey())), [])
})

test('drafts are left out: an unfinished inspection is not a record', async () => {
  const { db, call, unitA, inspector } = await withInspection()
  await call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: unitA } })

  const rows = await collectRows(db, unitA, monthKey())
  assert.equal(rows.length, 1)
})

/* -------------------------------------------------------------- the CSV -- */

test('a note that looks like a formula is written as text', () => {
  const csv = toCsv([
    { inspection_id: 1, rating: 'critical', note: '=HYPERLINK("http://evil","click")' },
    { inspection_id: 2, rating: 'critical', note: '-2 degrees at the probe' },
    { inspection_id: 3, rating: 'critical', note: '+1 door open' },
  ])

  // Not cosmetic: Excel and Sheets execute a cell beginning = + - or @, and
  // these fields are free text an inspector typed on a phone.
  for (const line of parse(csv).slice(1)) {
    // Quoted or not, the apostrophe comes first and the formula character
    // after it, so the spreadsheet reads the cell as text.
    assert.match(line, /,"?'[=+-]/, `formula not neutralised in: ${line}`)
  }
})

test('quotes, commas and newlines survive the round trip', () => {
  const csv = toCsv([{ inspection_id: 1, rating: 'critical', note: 'He said "move it", then\nleft' }])
  assert.match(csv, /"He said ""move it"", then\nleft"/)
})

test('the header names every column exactly once', () => {
  const [header] = parse(toCsv([]))
  const names = header.split(',')
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.includes('Rating') && names.includes('Note') && names.includes('Photos'))
})

/* ------------------------------------------------------------ the write -- */

test('the sheet is created in Drive as a real spreadsheet', async () => {
  const { bindings, config, db, unitA, state } = await withInspection()

  const result = await buildMonthlySheet(bindings, config, db, { unitId: unitA })

  assert.equal(result.rows, 1)
  assert.ok(result.fileId)
  const file = state.files.get(result.fileId)
  // Asked for as a Sheet, not a CSV attachment somebody has to import first.
  assert.equal(file.metadata.mimeType, 'application/vnd.google-apps.spreadsheet')
  assert.deepEqual(file.metadata.parents, ['fake-folder'])
  assert.match(file.metadata.name, /^Inspections LHR \d{4}-\d{2}$/)
  assert.match(new TextDecoder().decode(file.bytes), /Fire door wedged open/)
})

test('rebuilding replaces the same file rather than making another', async () => {
  const { bindings, config, db, call, unitA, inspector, state } = await withInspection()

  const first = await buildMonthlySheet(bindings, config, db, { unitId: unitA })
  const before = state.files.size

  const second = (
    await call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: unitA } })
  ).body
  const item = second.sections[0].items[1]
  await call(`/inspections/${second.id}`, {
    method: 'PATCH',
    token: inspector,
    body: { items: [{ template_item_id: item.id, rating: 'needs_improvement', note: 'Chipped tile' }] },
  })
  await signInspection(call, inspector, second.id, 'LHR Inspector')
  await call(`/inspections/${second.id}/submit`, { method: 'POST', token: inspector })

  const again = await buildMonthlySheet(bindings, config, db, { unitId: unitA })

  assert.equal(again.fileId, first.fileId, 'a link to this month stays valid all month')
  assert.equal(state.files.size, before, 'and Drive does not fill up with one file per night')
  assert.equal(again.rows, 2)
  assert.match(new TextDecoder().decode(state.files.get(again.fileId).bytes), /Chipped tile/)
})

test('a sheet someone deleted from Drive is made again', async () => {
  const { bindings, config, db, unitA, state } = await withInspection()

  const first = await buildMonthlySheet(bindings, config, db, { unitId: unitA })
  state.files.delete(first.fileId)

  const again = await buildMonthlySheet(bindings, config, db, { unitId: unitA })
  assert.notEqual(again.fileId, first.fileId)
  assert.ok(state.files.has(again.fileId))
  // And the database now points at the new one.
  const row = await db.get('SELECT file_id FROM unit_month_exports WHERE unit_id = @u', { u: unitA })
  assert.equal(row.file_id, again.fileId)
})

test('the rebuild is a view of the database: hand-edits do not survive it', async () => {
  const { bindings, config, db, unitA, state } = await withInspection()

  const built = await buildMonthlySheet(bindings, config, db, { unitId: unitA })
  // Somebody opens the sheet and types over a rating.
  state.files.set(built.fileId, { ...state.files.get(built.fileId), bytes: new TextEncoder().encode('tampered') })

  await buildMonthlySheet(bindings, config, db, { unitId: unitA })
  const text = new TextDecoder().decode(state.files.get(built.fileId).bytes)
  assert.doesNotMatch(text, /tampered/)
  assert.match(text, /critical/)
})

/* ------------------------------------------------------------- the cron -- */

test('the nightly run builds every active unit', async () => {
  const { bindings, config, db, state } = await withInspection()

  const report = await rebuildMonthlySheets(bindings, config, db)
  assert.equal(report.built, 2, 'both units, even the one with no inspections')
  assert.equal(report.failed, 0)
  assert.equal(state.files.size, 2)
})

test('on the first of the month last month is rebuilt too', async () => {
  const { bindings, config, db } = await withInspection()

  const firstOfMonth = new Date(Date.UTC(2026, 5, 1, 3, 10))
  await rebuildMonthlySheets(bindings, config, db, { at: firstOfMonth })

  const periods = await db.pluck('SELECT DISTINCT period FROM unit_month_exports ORDER BY period')
  // Late submissions have to land in the month they belong to before the file
  // is left alone for good.
  assert.deepEqual(periods, ['2026-05', '2026-06'])
})

test('without Drive the run says so instead of failing', async () => {
  const h = await createHarness()
  await seedFixture(h.db)

  const report = await rebuildMonthlySheets(h.bindings, readConfig(h.bindings), h.db)
  assert.equal(report.built, 0)
  assert.match(report.skipped, /not Drive/)
})

/* ------------------------------------------------------------ the routes -- */

test('a manager can download the month as a CSV', async () => {
  const { call } = await withInspection()
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  const res = await call(`/units/1/exports/monthly.csv`, { token })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/csv/)
  assert.match(res.headers.get('content-disposition'), /inspections-\d{4}-\d{2}\.csv/)
  assert.match(res.body, /Fire door wedged open/)
})

test('a rebuild can be asked for on demand', async () => {
  const { call, state } = await withInspection()
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  const res = await call(`/units/1/exports/monthly-sheet`, { method: 'POST', token, body: {} })
  assert.equal(res.status, 200)
  assert.ok(res.body.fileId)
  assert.match(res.body.link, /drive\.google\.com/)
  assert.ok(state.files.has(res.body.fileId))
})

test('a unit you cannot reach is not exportable', async () => {
  const { call } = await withInspection()
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  // unit B belongs to another manager; this one may not read its findings.
  const res = await call(`/units/2/exports/monthly.csv`, { token })
  assert.equal(res.status, 404)
})

test('a nonsense month is refused rather than silently returning nothing', async () => {
  const { call } = await withInspection()
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  const res = await call(`/units/1/exports/monthly.csv?period=2026-13`, { token })
  assert.equal(res.status, 422)
})

test('the screen can ask where this month\'s sheet is', async () => {
  const { bindings, config, db, call, unitA } = await withInspection()
  const token = await signIn(call, 'lhr.manager', 'manager-password')

  const before = await call(`/units/${unitA}/exports/monthly-sheet`, { token })
  assert.equal(before.status, 200)
  assert.equal(before.body.built, false, 'a month with no sheet yet is not an error')

  await buildMonthlySheet(bindings, config, db, { unitId: unitA })

  const after = await call(`/units/${unitA}/exports/monthly-sheet`, { token })
  assert.equal(after.body.built, true)
  assert.equal(after.body.row_count, 1)
  assert.match(after.body.web_view_link, /drive\.google\.com/)
})
