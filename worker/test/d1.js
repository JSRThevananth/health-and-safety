import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A D1 binding, implemented over Node's own SQLite, so the test suite can drive
 * the real Hono app under plain `node --test`.
 *
 * node:sqlite rather than better-sqlite3 deliberately: better-sqlite3 is a
 * native addon, and on a Windows machine without Visual Studio it fails to
 * build - which makes "npm install" fail for someone who only wants to deploy
 * the app. A test dependency must never be able to do that.
 *
 * The alternative is Miniflare, which runs the actual Workers runtime but needs
 * vitest and a worker pool to do it. This keeps the tests dependency-light and
 * fast; what it cannot catch is a difference between SQLite and D1's own SQLite
 * build, which in practice is the 100-parameter limit - so that limit is enforced
 * here too, and a query that would be rejected in production is rejected in the
 * tests as well.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = path.join(here, '..', 'migrations')

const MAX_BOUND_PARAMS = 100

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.params = []
  }

  bind(...params) {
    if (params.length > MAX_BOUND_PARAMS) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${params.length} > ${MAX_BOUND_PARAMS}): ${this.sql.slice(0, 80)}`
      )
    }
    this.params = params
    return this
  }

  prepared() {
    return this.db.prepare(this.sql)
  }

  /**
   * node:sqlite treats ?1 and ?2 as *named* parameters and refuses an array for
   * them, while D1 binds them positionally like any other placeholder. The
   * app's own queries use ?N (so a name used twice binds one value) and its bulk
   * inserts use plain ?, so both shapes have to work here.
   */
  bound() {
    const withoutLiterals = this.sql.replace(/'[^']*'/g, '')
    // Plain ? placeholders bind positionally, one argument each.
    if (!/\?\d/.test(withoutLiterals)) return this.params
    // ?1, ?2 bind as one object of names - and it must be the only argument,
    // or node:sqlite goes looking for a parameter called '0'.
    return [Object.fromEntries(this.params.map((value, index) => [String(index + 1), value]))]
  }

  async first(column) {
    const row = this.prepared().get(...this.bound())
    if (row === undefined) return null
    return column === undefined ? row : row[column]
  }

  async all() {
    // node:sqlite runs .all() on a write statement too and returns no rows,
    // which is what D1 reports as well - so there is nothing to ask first.
    return { success: true, results: this.prepared().all(...this.bound()), meta: { changes: 0 } }
  }

  async run() {
    return { success: true, results: [], meta: meta(this.prepared().run(...this.bound())) }
  }
}

const meta = (info) => ({
  changes: info.changes,
  last_row_id: Number(info.lastInsertRowid),
  duration: 0,
})

class FakeD1 {
  constructor(db) {
    this.db = db
  }

  prepare(sql) {
    return new FakeStatement(this.db, sql)
  }

  /**
   * D1 runs a batch as one transaction; so does this.
   *
   * Driven by hand because node:sqlite has no transaction helper. The rollback
   * is the part that matters: a test proves one bad statement takes the whole
   * batch down with it, exactly as D1 does.
   */
  async batch(statements) {
    this.db.exec('BEGIN')
    try {
      const results = statements.map((s) => ({
        success: true,
        results: [],
        meta: meta(s.prepared().run(...s.bound())),
      }))
      this.db.exec('COMMIT')
      return results
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async exec(sql) {
    this.db.exec(sql)
    return { count: 0, duration: 0 }
  }
}

/** A fresh in-memory database with every migration applied. */
export function createTestD1() {
  // Foreign keys are enforced by default here, as they are in D1.
  const db = new DatabaseSync(':memory:')

  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }

  return new FakeD1(db)
}

/** An R2 bucket, in memory, with the handful of methods the app uses. */
export function createTestR2() {
  const objects = new Map()
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, { value, httpMetadata: options.httpMetadata || {} })
      return { key }
    },
    async get(key) {
      const object = objects.get(key)
      if (!object) return null
      return { body: new Blob([object.value]).stream(), ...object }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
}
