/**
 * The D1 data layer.
 *
 * Queries are written with @named parameters, as they were against SQLite and
 * Postgres, and translated here into the ?NNN placeholders D1 binds. Numbered
 * rather than plain ? so a name used twice in one statement binds one value.
 *
 * Two D1 facts shape everything below:
 *
 *  - There are no interactive transactions. A Worker cannot hold BEGIN open across
 *    awaits, so a multi-statement write is expressed as db.batch([...]), which D1
 *    runs as one atomic transaction. Code that needs an id before inserting its
 *    children cannot be a single batch; those places say so and clean up after
 *    themselves.
 *  - A single statement may bind at most 100 parameters. Bulk inserts are therefore
 *    chunked into several multi-row statements and submitted as one batch, which
 *    keeps them atomic while staying under the cap.
 */

/** D1's cap. Exceed it and the query is rejected outright, not truncated. */
export const MAX_BOUND_PARAMS = 100

export function toNumbered(sql, params = {}) {
  const values = []
  const seen = new Map()

  // Skip @ inside string literals so an email address in a query is left alone.
  const text = sql.replace(/'[^']*'|@([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
    if (!name) return match
    if (!seen.has(name)) {
      if (!(name in params)) throw new Error(`Query references @${name} but no value was given`)
      values.push(normalise(params[name]))
      seen.set(name, values.length)
    }
    return `?${seen.get(name)}`
  })

  return { text, values }
}

/**
 * D1 binds null, number, string, ArrayBuffer and boolean only. undefined arrives as
 * a missing binding and the query fails with a message that names no column, so it
 * is worth converting here where the cause is still obvious.
 */
function normalise(value) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

export function createDb(d1) {
  const bind = (sql, params) => {
    if (Array.isArray(params)) return d1.prepare(sql).bind(...params.map(normalise))
    const { text, values } = toNumbered(sql, params)
    return values.length ? d1.prepare(text).bind(...values) : d1.prepare(text)
  }

  const db = {
    raw: d1,

    /** One row, or undefined. */
    async get(sql, params = {}) {
      return (await bind(sql, params).first()) ?? undefined
    },

    /** Every row. */
    async all(sql, params = {}) {
      const { results } = await bind(sql, params).all()
      return results ?? []
    },

    /** A single column from every row, which is most of what the app asks for. */
    async pluck(sql, params = {}) {
      const rows = await db.all(sql, params)
      return rows.map((row) => Object.values(row)[0])
    },

    async run(sql, params = {}) {
      const { meta } = await bind(sql, params).run()
      return { changes: meta?.changes ?? 0 }
    },

    /**
     * Insert and return the new id.
     *
     * last_row_id comes back in the statement's own metadata, so this is one round
     * trip rather than an insert followed by a SELECT - which under concurrency
     * could return somebody else's row.
     */
    async insert(sql, params = {}) {
      const { meta } = await bind(sql, params).run()
      return { id: Number(meta?.last_row_id), changes: meta?.changes ?? 0 }
    },

    /** Prepare a statement for batch() without running it. */
    stmt(sql, params = {}) {
      return bind(sql, params)
    },

    /** Run prepared statements as one atomic transaction. */
    async batch(statements) {
      const real = statements.filter(Boolean)
      if (real.length === 0) return []
      return d1.batch(real)
    },

    /**
     * Statements that insert `rows` into `table`, split so none binds more than
     * D1 allows. Pass the result to batch() and the whole insert is atomic.
     */
    bulkInsert(table, columns, rows) {
      if (rows.length === 0) return []
      const perRow = columns.length
      if (perRow > MAX_BOUND_PARAMS) {
        throw new Error(`${table} has ${perRow} columns; a single row already exceeds D1's limit`)
      }
      const rowsPerStatement = Math.floor(MAX_BOUND_PARAMS / perRow)

      const statements = []
      for (let i = 0; i < rows.length; i += rowsPerStatement) {
        const chunk = rows.slice(i, i + rowsPerStatement)
        const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
        const values = chunk.flatMap((row) => columns.map((c) => normalise(row[c])))
        statements.push(
          d1.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`).bind(...values)
        )
      }
      return statements
    },

    /**
     * An IN (...) clause for a list of ids, with the list inlined rather than bound.
     *
     * Unit and permission lists routinely run past 100 entries, and every value is
     * an integer this code produced, never user text - so each one is forced
     * through Number() and a non-integer throws instead of reaching the database.
     */
    idList(ids) {
      const clean = ids.map((id) => {
        const n = Number(id)
        if (!Number.isInteger(n)) throw new Error(`Not an id: ${JSON.stringify(id)}`)
        return n
      })
      return clean.length ? clean.join(',') : 'NULL'
    },
  }

  return db
}

/** The one timestamp format the app stores, everywhere. */
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Today, as the YYYY-MM-DD the date columns use. */
export const today = () => new Date().toISOString().slice(0, 10)
