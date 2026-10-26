/**
 * Sheets as tables.
 *
 * Every Sheets API call costs a round trip of roughly 100-300ms, so the rule here
 * is: read a whole tab once per execution, work in memory, and write in batches.
 * Reading row by row is what makes Apps Script projects feel slow.
 *
 * Writes take a script lock. Two inspectors submitting at the same moment would
 * otherwise interleave and one would silently overwrite the other.
 */

// Per-execution memory. Apps Script starts a fresh runtime for each call, so this
// lives only for the length of one request - which is exactly the scope we want.
const _tableCache = {};

function _sheet(table) {
  const ss = SpreadsheetApp.openById(getConfig().spreadsheetId);
  const sheet = ss.getSheetByName(table);
  if (!sheet) throw new Error('No such table: ' + table + '. Run setUp() first.');
  return sheet;
}

/** Convert a value coming out of Sheets into the type the app expects. */
function _coerce(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (value instanceof Date) return Utilities.formatDate(value, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  return value;
}

/** Rows -> objects, using the header row for keys. Pure, given its inputs. */
function rowsToObjects(header, rows) {
  return rows
    .map(function (row) {
      const obj = {};
      for (let i = 0; i < header.length; i += 1) obj[header[i]] = _coerce(row[i]);
      return obj;
    })
    // A deleted row leaves a blank; treat anything without an id as absent.
    .filter(function (obj) { return obj.id !== null && obj.id !== ''; });
}

/** An object -> a row in the tab's column order. Missing keys become blank. */
function objectToRow(header, obj) {
  return header.map(function (key) {
    const v = obj[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

/** Read an entire table. Cached for the rest of this execution. */
function dbAll(table) {
  if (_tableCache[table]) return _tableCache[table];

  const sheet = _sheet(table);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return (_tableCache[table] = []);

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(String);
  const rows = values.slice(1);
  return (_tableCache[table] = rowsToObjects(header, rows));
}

function dbFind(table, predicate) {
  return dbAll(table).filter(predicate);
}

function dbFirst(table, predicate) {
  const matches = dbAll(table).filter(predicate);
  return matches.length > 0 ? matches[0] : null;
}

function dbGet(table, id) {
  const key = Number(id);
  return dbFirst(table, function (r) { return Number(r.id) === key; });
}

function _nextId(table) {
  const rows = dbAll(table);
  let max = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const n = Number(rows[i].id);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Append one record, assigning its id. Must be called inside dbTransaction so the
 * id cannot be handed out twice to two simultaneous runs.
 */
function dbInsert(table, record) {
  const sheet = _sheet(table);
  const header = SCHEMA[table];
  const row = Object.assign({}, record, { id: _nextId(table) });

  sheet.appendRow(objectToRow(header, row));
  if (_tableCache[table]) _tableCache[table].push(row);
  return row;
}

/** Append many records in one write, which is far cheaper than one call each. */
function dbInsertMany(table, records) {
  if (records.length === 0) return [];
  const sheet = _sheet(table);
  const header = SCHEMA[table];

  let id = _nextId(table);
  const withIds = records.map(function (r) {
    return Object.assign({}, r, { id: id++ });
  });

  sheet
    .getRange(sheet.getLastRow() + 1, 1, withIds.length, header.length)
    .setValues(withIds.map(function (r) { return objectToRow(header, r); }));

  if (_tableCache[table]) Array.prototype.push.apply(_tableCache[table], withIds);
  return withIds;
}

/** Find the physical row number of a record, or 0 if it is not present. */
function _rowNumber(table, id) {
  const sheet = _sheet(table);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const key = Number(id);
  for (let i = 0; i < ids.length; i += 1) {
    if (Number(ids[i][0]) === key) return i + 2; // +2: 1-indexed, past the header
  }
  return 0;
}

function dbUpdate(table, id, patch) {
  const rowNumber = _rowNumber(table, id);
  if (!rowNumber) return null;

  const header = SCHEMA[table];
  const sheet = _sheet(table);
  const current = rowsToObjects(header, [sheet.getRange(rowNumber, 1, 1, header.length).getValues()[0]])[0];
  const merged = Object.assign({}, current, patch, { id: Number(id) });

  sheet.getRange(rowNumber, 1, 1, header.length).setValues([objectToRow(header, merged)]);
  delete _tableCache[table];
  return merged;
}

function dbDelete(table, id) {
  const rowNumber = _rowNumber(table, id);
  if (!rowNumber) return false;
  _sheet(table).deleteRow(rowNumber);
  delete _tableCache[table];
  return true;
}

/** Delete several records in one pass, bottom-up so row numbers stay valid. */
function dbDeleteWhere(table, predicate) {
  const doomed = dbAll(table).filter(predicate).map(function (r) { return Number(r.id); });
  if (doomed.length === 0) return 0;

  const sheet = _sheet(table);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const rowNumbers = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (doomed.indexOf(Number(ids[i][0])) !== -1) rowNumbers.push(i + 2);
  }

  // Descending: deleting a row shifts everything below it up.
  rowNumbers.sort(function (a, b) { return b - a; });
  rowNumbers.forEach(function (n) { sheet.deleteRow(n); });

  delete _tableCache[table];
  return rowNumbers.length;
}

/**
 * Run a function with exclusive write access.
 *
 * This is what keeps two inspectors from overwriting each other. Everything that
 * writes must go through it; a read-only path does not need it.
 */
function dbTransaction(fn) {
  const lock = LockService.getScriptLock();
  // 30s: long enough for a slow batch write, short enough that a stuck run does not
  // hold everyone else up indefinitely.
  if (!lock.tryLock(30000)) {
    throw new Error('The system is busy saving someone else\'s work. Please try again.');
  }
  try {
    // Anything cached before the lock may now be stale.
    Object.keys(_tableCache).forEach(function (k) { delete _tableCache[k]; });
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Drop the per-execution cache. Useful in tests and long-running jobs. */
function dbResetCache() {
  Object.keys(_tableCache).forEach(function (k) { delete _tableCache[k]; });
}
