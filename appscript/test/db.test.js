import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

/** A runtime with the schema already created. */
function withSchema() {
  const rt = createRuntime({ config: { SPREADSHEET_ID: 'fake-sheet-id' } })
  rt.load('Config.gs', 'Schema.gs', 'Db.gs')
  rt.sandbox.ensureSchema()
  return rt
}

test('ensureSchema creates every tab with its header row', () => {
  const rt = withSchema()
  const names = rt.spreadsheet.getSheets().map((s) => s.getName())
  assert.equal(names.length, 18)
  assert.ok(names.includes('Inspections'))
  assert.ok(names.includes('Recipients'))

  const users = rt.spreadsheet.getSheetByName('Users')
  // Spread across the realm boundary: the vm has its own Array prototype, so a
  // structurally identical array is not reference-equal to one from here.
  assert.deepEqual(users.values[0], [...rt.evaluate('SCHEMA.Users')])
})

test('ensureSchema is safe to run again and does not duplicate', () => {
  const rt = withSchema()
  const before = rt.spreadsheet.getSheets().length
  rt.sandbox.ensureSchema()
  assert.equal(rt.spreadsheet.getSheets().length, before)

  const users = rt.spreadsheet.getSheetByName('Users')
  assert.equal(users.values.length, 1, 'still only a header row')
})

test('tabs holding credentials are hidden from anyone opening the sheet', () => {
  const rt = withSchema()
  assert.equal(rt.spreadsheet.getSheetByName('Users').hidden, true)
  assert.equal(rt.spreadsheet.getSheetByName('Sessions').hidden, true)
  assert.equal(rt.spreadsheet.getSheetByName('Units').hidden, false)
})

test('insert assigns sequential ids and reads back', () => {
  const rt = withSchema()
  const { dbInsert, dbGet, dbAll } = rt.sandbox

  const a = dbInsert('Units', { tenant_id: 1, name: 'Heathrow', code: 'LHR' })
  const b = dbInsert('Units', { tenant_id: 1, name: 'Dubai', code: 'DXB' })
  assert.equal(a.id, 1)
  assert.equal(b.id, 2)

  assert.equal(dbGet('Units', 1).name, 'Heathrow')
  assert.equal(dbAll('Units').length, 2)
})

test('booleans survive the round trip as 1 and 0', () => {
  const rt = withSchema()
  const { dbInsert, dbGet } = rt.sandbox
  const row = dbInsert('Units', { name: 'X', code: 'X', active: true })
  rt.sandbox.dbResetCache()
  assert.equal(dbGet('Units', row.id).active, 1)
})

test('update merges rather than replacing the row', () => {
  const rt = withSchema()
  const { dbInsert, dbUpdate, dbGet } = rt.sandbox

  const unit = dbInsert('Units', { tenant_id: 1, name: 'Heathrow', code: 'LHR', location: 'London' })
  dbUpdate('Units', unit.id, { name: 'Heathrow Catering' })

  const after = dbGet('Units', unit.id)
  assert.equal(after.name, 'Heathrow Catering')
  assert.equal(after.location, 'London', 'untouched columns must survive an update')
  assert.equal(after.code, 'LHR')
})

test('delete removes only the intended row and ids stay stable', () => {
  const rt = withSchema()
  const { dbInsert, dbDelete, dbGet, dbAll } = rt.sandbox

  dbInsert('Units', { name: 'A', code: 'A' })
  const b = dbInsert('Units', { name: 'B', code: 'B' })
  dbInsert('Units', { name: 'C', code: 'C' })

  dbDelete('Units', b.id)
  const remaining = dbAll('Units')
  assert.equal(remaining.length, 2)
  assert.deepEqual(remaining.map((r) => r.name), ['A', 'C'])
  assert.equal(dbGet('Units', 3).name, 'C', 'C keeps its original id')
})

test('deleting several rows does not shift the wrong ones out', () => {
  const rt = withSchema()
  const { dbInsert, dbDeleteWhere, dbAll } = rt.sandbox

  for (const name of ['A', 'B', 'C', 'D', 'E']) dbInsert('Units', { name, code: name })
  // Deleting top-down would shift rows and remove the wrong records.
  const removed = dbDeleteWhere('Units', (r) => ['B', 'C', 'E'].includes(r.name))

  assert.equal(removed, 3)
  assert.deepEqual(dbAll('Units').map((r) => r.name), ['A', 'D'])
})

test('insertMany writes in one batch and numbers sequentially', () => {
  const rt = withSchema()
  const { dbInsertMany, dbAll } = rt.sandbox

  const rows = dbInsertMany('InspectionItems', [
    { inspection_id: 1, template_item_id: 10, rating: 'critical', note: 'a' },
    { inspection_id: 1, template_item_id: 11, rating: 'needs_improvement', note: 'b' },
    { inspection_id: 1, template_item_id: 12, rating: 'critical', note: 'c' },
  ])
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3])
  assert.equal(dbAll('InspectionItems').length, 3)
})

test('a transaction holds an exclusive lock while it runs', () => {
  const rt = withSchema()
  const { dbTransaction } = rt.sandbox

  assert.equal(rt.isLocked(), false)
  const result = dbTransaction(() => {
    assert.equal(rt.isLocked(), true, 'the lock must be held inside the transaction')
    return 'done'
  })
  assert.equal(result, 'done')
  assert.equal(rt.isLocked(), false, 'and released afterwards')
})

test('the lock is released even when the work throws', () => {
  const rt = withSchema()
  const { dbTransaction } = rt.sandbox

  assert.throws(() => dbTransaction(() => { throw new Error('boom') }), /boom/)
  assert.equal(rt.isLocked(), false, 'a failure must not strand the lock and block everyone')
})

test('a second writer is refused rather than corrupting data', () => {
  const rt = withSchema()
  const { dbTransaction } = rt.sandbox

  dbTransaction(() => {
    assert.throws(
      () => dbTransaction(() => 'should not get here'),
      /busy saving/,
      'the second writer must be told to retry, not allowed to interleave'
    )
  })
})

test('blank rows left by a deletion are ignored, not read as records', () => {
  const rt = withSchema()
  const { dbInsert, dbAll } = rt.sandbox
  dbInsert('Units', { name: 'Real', code: 'R' })

  // Sheets leaves an empty row behind when a person deletes contents by hand.
  rt.spreadsheet.getSheetByName('Units').values.push(['', '', '', '', '', '', '', ''])
  rt.sandbox.dbResetCache()

  const rows = dbAll('Units')
  assert.equal(rows.length, 1, 'a blank row is not a record')
  assert.equal(rows[0].name, 'Real')
})

test('a Date from Sheets is normalised to the ISO text the app stores', () => {
  const rt = withSchema()
  const { dbAll } = rt.sandbox
  const sheet = rt.spreadsheet.getSheetByName('Units')
  sheet.values.push([1, 1, 'Heathrow', 'LHR', '', 'UTC', 1, new Date('2026-09-01T12:00:00Z')])
  rt.sandbox.dbResetCache()

  assert.equal(dbAll('Units')[0].created_at, '2026-09-01T12:00:00Z')
})
