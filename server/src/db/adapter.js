import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toPositional, schemaToPostgres } from './sql.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(here, 'schema.sql')

/**
 * One async database interface over two engines.
 *
 * SQLite keeps local development to "npm install, npm run dev" with no database
 * server to install. Postgres is what production needs, because a hosted service's
 * local disk does not survive a restart.
 *
 * The interface is async for both, even though SQLite is synchronous underneath, so
 * application code is written once and cannot accidentally depend on one engine's
 * timing. Every query is written with @named parameters and translated per engine.
 */

/* ------------------------------------------------------------------ SQLite -- */

async function createSqlite(file) {
  const { default: Database } = await import('better-sqlite3')
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(schemaPath, 'utf8'))

  const prep = (sql) => db.prepare(sql)

  const api = {
    engine: 'sqlite',
    async get(sql, params = {}) {
      return prep(sql).get(params)
    },
    async all(sql, params = {}) {
      return prep(sql).all(params)
    },
    async run(sql, params = {}) {
      const r = prep(sql).run(params)
      return { changes: r.changes }
    },
    async insert(sql, params = {}) {
      const r = prep(sql).run(params)
      return { id: Number(r.lastInsertRowid), changes: r.changes }
    },
    async exec(sql) {
      db.exec(sql)
    },
    async tx(fn) {
      // better-sqlite3 transactions are synchronous, so drive BEGIN/COMMIT by hand
      // to keep the same shape as the Postgres implementation.
      db.exec('BEGIN')
      try {
        const out = await fn(api)
        db.exec('COMMIT')
        return out
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    async close() {
      db.close()
    },
  }
  return api
}

/* ---------------------------------------------------------------- Postgres -- */

async function createPostgres(connectionString) {
  const { default: pg } = await import('pg')

  const pool = new pg.Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    // Managed Postgres (Neon, Supabase) requires TLS; a local instance does not.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  })

  const query = async (client, sql, params) => {
    const { text, values } = toPositional(sql, params)
    return (client ?? pool).query(text, values)
  }

  const build = (client) => ({
    engine: 'postgres',
    async get(sql, params = {}) {
      const r = await query(client, sql, params)
      return r.rows[0]
    },
    async all(sql, params = {}) {
      const r = await query(client, sql, params)
      return r.rows
    },
    async run(sql, params = {}) {
      const r = await query(client, sql, params)
      return { changes: r.rowCount }
    },
    async insert(sql, params = {}) {
      // Postgres has no lastInsertRowid; ask for the id back instead.
      const withReturning = /returning/i.test(sql) ? sql : `${sql.trimEnd().replace(/;$/, '')} RETURNING id`
      const r = await query(client, withReturning, params)
      return { id: Number(r.rows[0]?.id), changes: r.rowCount }
    },
    async exec(sql) {
      await (client ?? pool).query(sql)
    },
    async tx(fn) {
      if (client) return fn(build(client)) // already inside one
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        const out = await fn(build(c))
        await c.query('COMMIT')
        return out
      } catch (error) {
        await c.query('ROLLBACK')
        throw error
      } finally {
        c.release()
      }
    },
    async close() {
      await pool.end()
    },
  })

  const api = build(null)
  await api.exec(schemaToPostgres(fs.readFileSync(schemaPath, 'utf8')))
  return api
}

/* -------------------------------------------------------------------------- */

export async function createAdapter({ url, file }) {
  if (url) return createPostgres(url)
  return createSqlite(file)
}
