/**
 * Portable SQL helpers.
 *
 * The app runs on SQLite locally - so a laptop needs no database server - and on
 * Postgres in production, where a hosted service's disk does not survive a restart.
 * These helpers cover the handful of places the two dialects genuinely differ.
 */

/**
 * Rewrite named parameters (@name) into the driver's own placeholder style, and
 * return the values in matching order.
 *
 * SQLite takes @name directly; Postgres takes $1, $2 positionally. Writing every
 * query in the named style keeps the call sites readable and dialect-free.
 */
export function toPositional(sql, params = {}) {
  const values = []
  const seen = new Map()

  // Skip @ inside string literals so an email in a query is left alone.
  const text = sql.replace(/'[^']*'|@([A-Za-z_][A-Za-z0-9_]*)/g, (match, name) => {
    if (!name) return match
    if (!seen.has(name)) {
      values.push(params[name])
      seen.set(name, values.length)
    }
    return `$${seen.get(name)}`
  })

  return { text, values }
}

/** Convert `?` placeholders to `$1, $2, ...` for Postgres. */
export function questionToPositional(sql) {
  let n = 0
  return sql.replace(/'[^']*'|\?/g, (m) => (m === '?' ? `$${++n}` : m))
}

/**
 * Translate the schema from its SQLite form into Postgres.
 *
 * The schema is written once, in SQLite's dialect, and translated rather than
 * maintained twice - two copies drift, and a drift between dev and production is
 * the kind of bug that only shows up in production.
 */
export function schemaToPostgres(sql) {
  return (
    sql
      // Postgres has no PRAGMA; the equivalents are defaults or not applicable.
      .replace(/^\s*PRAGMA[^;]*;\s*$/gim, '')
      // Keep the column type: Postgres needs "INTEGER GENERATED ALWAYS AS IDENTITY".
      .replace(
        /INTEGER PRIMARY KEY AUTOINCREMENT/gi,
        'INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY'
      )
      // Timestamps are stored as the same ISO text on both engines, so a record
      // written on one is byte-identical to one written on the other.
      .replace(
        /datetime\('now'\)/gi,
        "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')"
      )
      .trim()
  )
}

/**
 * A timestamp in the single format the app stores everywhere.
 *
 * Supplied from JavaScript rather than by each dialect's own now() function, so a
 * record written on SQLite and one written on Postgres are byte-identical.
 */
export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Today, as the YYYY-MM-DD the date columns use. */
export const today = () => new Date().toISOString().slice(0, 10)
