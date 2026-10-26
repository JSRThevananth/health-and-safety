import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import nodeCrypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '..', 'src')

/**
 * Runs .gs files under Node with the Apps Script globals they expect.
 *
 * Apps Script cannot be executed outside Google, so without this the logic would
 * ship unverified. The fakes below are deliberately faithful about the things that
 * cause real bugs - Sheets returning Date objects and blank strings, appendRow
 * semantics, row numbers shifting on delete, the lock being exclusive - rather
 * than being convenient.
 */

/** An in-memory stand-in for one sheet. */
class FakeSheet {
  constructor(name) {
    this.name = name
    this.values = [] // array of rows
    this.frozenRows = 0
    this.hidden = false
  }
  getName() { return this.name }
  getLastRow() { return this.values.length }
  getLastColumn() { return this.values.reduce((m, r) => Math.max(m, r.length), 0) }
  setFrozenRows(n) { this.frozenRows = n }
  hideSheet() { this.hidden = true }

  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this
    return {
      getValues() {
        const out = []
        for (let r = 0; r < numRows; r += 1) {
          const source = sheet.values[row - 1 + r] || []
          const line = []
          for (let c = 0; c < numCols; c += 1) {
            line.push(source[col - 1 + c] === undefined ? '' : source[col - 1 + c])
          }
          out.push(line)
        }
        return out
      },
      setValues(vals) {
        vals.forEach((line, r) => {
          const target = row - 1 + r
          if (!sheet.values[target]) sheet.values[target] = []
          line.forEach((v, c) => { sheet.values[target][col - 1 + c] = v })
        })
        return this
      },
      setFontWeight() { return this },
      setNumberFormat() { return this },
    }
  }

  appendRow(row) { this.values.push(row.slice()) }

  deleteRow(n) { this.values.splice(n - 1, 1) }
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map() }
  getSheetByName(name) { return this.sheets.get(name) || null }
  insertSheet(name) {
    const s = new FakeSheet(name)
    this.sheets.set(name, s)
    return s
  }
  deleteSheet(sheet) { this.sheets.delete(sheet.getName()) }
  getSheets() { return [...this.sheets.values()] }
}

export function createRuntime({ config = {}, now = () => new Date('2026-09-01T12:00:00Z') } = {}) {
  const spreadsheet = new FakeSpreadsheet()
  const sent = []       // Brevo calls
  const driveFiles = [] // Drive uploads
  let lockHeld = false
  const scriptCache = new Map()

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    String, Number, Boolean, Array, Object, Error, RegExp,
    isNaN, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent,

    SpreadsheetApp: {
      openById: () => spreadsheet,
      getActiveSpreadsheet: () => spreadsheet,
    },

    LockService: {
      getScriptLock: () => ({
        tryLock(ms) {
          if (lockHeld) return false
          lockHeld = true
          return true
        },
        releaseLock() { lockHeld = false },
        hasLock() { return lockHeld },
      }),
    },

    Utilities: {
      formatDate(date, tz, fmt) {
        // Only the ISO shape the app actually uses.
        return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
      },
      computeDigest(_algo, input) {
        // Deterministic stand-in: real Apps Script returns signed bytes, so mirror
        // that range rather than producing values the real thing never would.
        const bytes = []
        let h1 = 0x811c9dc5
        const text = typeof input === 'string' ? input : String(input)
        for (let i = 0; i < 32; i += 1) {
          for (let j = 0; j < text.length; j += 1) {
            h1 ^= text.charCodeAt(j) + i
            h1 = Math.imul(h1, 0x01000193) >>> 0
          }
          bytes.push(((h1 >>> (i % 24)) & 0xff) - 128)
        }
        return bytes
      },
      base64Encode: (input) =>
        Buffer.from(Array.isArray(input) ? Uint8Array.from(input.map((b) => b & 0xff)) : String(input)).toString('base64'),
      base64Decode: (s) => Array.from(Buffer.from(s, 'base64')),
      base64EncodeWebSafe: (input) =>
        Buffer.from(String(input)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) =>
        Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (bytes) => ({
        getDataAsString: () => Buffer.from(Uint8Array.from(bytes.map((b) => (b + 256) % 256))).toString('utf8'),
        getBytes: () => bytes,
        getName: () => 'blob',
      }),
      // Real HMAC, so signing and verification are exercised for real rather than
      // against a stand-in that would hide a mistake.
      computeHmacSha256Signature: (value, key) => {
        const mac = nodeCrypto.createHmac('sha256', String(key)).update(String(value)).digest()
        return Array.from(mac).map((b) => (b > 127 ? b - 256 : b))
      },
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2, 10),
      sleep: () => {},
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
    },

    UrlFetchApp: {
      fetch(url, options) {
        sent.push({ url, options })
        return {
          getResponseCode: () => 201,
          getContentText: () => JSON.stringify({ messageId: 'fake-' + sent.length }),
        }
      },
    },

    DriveApp: {
      getFolderById: (id) => ({
        createFile: (blob) => {
          const file = {
            id: 'drive-' + (driveFiles.length + 1),
            name: blob.getName ? blob.getName() : 'file',
            size: blob.getBytes ? blob.getBytes().length : 0,
          }
          driveFiles.push(file)
          return {
            getId: () => file.id,
            getName: () => file.name,
            getSize: () => file.size,
            getUrl: () => 'https://drive.google.com/file/d/' + file.id + '/view',
            setTrashed: () => { file.trashed = true },
          }
        },
      }),
      getFileById: (id) => {
        const f = driveFiles.find((x) => x.id === id)
        if (!f) throw new Error('File not found: ' + id)
        return {
          getId: () => f.id,
          getBlob: () => ({ getBytes: () => [], getName: () => f.name }),
          setTrashed: () => { f.trashed = true },
        }
      },
    },

    /*
     * One store for the whole runtime. Returning a fresh Map per call - as an
     * earlier version of this fake did - silently defeats anything that counts
     * across calls, such as the sign-in rate limiter, and makes a broken throttle
     * look like a working one.
     */
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (scriptCache.has(k) ? scriptCache.get(k) : null),
        put: (k, v) => scriptCache.set(k, v),
        remove: (k) => scriptCache.delete(k),
      }),
    },

    PropertiesService: {
      getScriptProperties: () => {
        const store = new Map(Object.entries(config))
        return {
          getProperty: (k) => (store.has(k) ? store.get(k) : null),
          setProperty: (k, v) => store.set(k, v),
          getProperties: () => Object.fromEntries(store),
        }
      },
    },

    Logger: { log: () => {} },

    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => ({
        timeBased: () => ({
          atHour: function () { return this },
          everyDays: function () { return this },
          onMonthDay: function () { return this },
          create: () => {},
        }),
      }),
    },

    HtmlService: {
      createHtmlOutputFromFile: () => ({
        setTitle: function () { return this },
        addMetaTag: function () { return this },
        setXFrameOptionsMode: function () { return this },
        setSandboxMode: function () { return this },
      }),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      SandboxMode: { IFRAME: 'IFRAME' },
    },

    Session: {
      getActiveUser: () => ({ getEmail: () => '' }),
      getScriptTimeZone: () => 'UTC',
    },
  }

  sandbox.globalThis = sandbox
  vm.createContext(sandbox)

  const load = (...files) => {
    for (const file of files) {
      const code = fs.readFileSync(path.join(SRC, file), 'utf8')
      vm.runInContext(code, sandbox, { filename: file })
    }
  }

  /*
   * Read a top-level binding from the loaded scripts.
   *
   * A top-level `const` lives in the context's lexical scope rather than on the
   * global object, so `sandbox.SCHEMA` is undefined even though the .gs files can
   * all see it - which is exactly how Apps Script behaves across .gs files too.
   */
  const evaluate = (expression) => vm.runInContext(expression, sandbox)

  return {
    sandbox, load, evaluate, spreadsheet, sent, driveFiles,
    isLocked: () => lockHeld,
    clearCache: () => scriptCache.clear(),
  }
}
