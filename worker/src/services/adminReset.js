/**
 * Reissuing the administrator account.
 *
 * A temporary password is shown once and stored only as a hash, so losing it
 * before signing in means the account can never be used - and on a first-run
 * deployment it is the only account, so there is nobody to reset it.
 *
 * The way out is to remove that unusable account so setup can issue a new one.
 * It is deliberately not something the app exposes over HTTP: anyone who could
 * call it could lock out the real administrator and take their place. It runs
 * from the command line, against the database, which only the account owner
 * can reach.
 *
 *   wrangler d1 execute qa-platform --remote --command "<the SQL below>"
 *
 * Several tables record which user created a row, and those references block
 * the delete, so they are cleared first. The one that cannot be cleared is
 * inspections.inspector_id, which is NOT NULL by design - an inspection
 * without an inspector is not a record of anything. So this only applies
 * before any inspection exists, which is exactly when a temporary password
 * gets lost.
 */

/** Tables holding an optional reference to a user, and the column. */
const SOFT_REFERENCES = [
  ['unit_templates', 'created_by'],
  ['unit_custom_items', 'created_by'],
  ['unit_recipients', 'created_by'],
  ['attachments', 'uploaded_by'],
  ['inspections', 'signed_by'],
  ['inspection_signatures', 'captured_by'],
]

/**
 * Remove an administrator who has never been used, so setup can issue another.
 * Refuses if they have carried out any inspection, because that record would
 * lose its author.
 */
export async function releaseAdminAccount(db, userId) {
  const { n: inspections } = await db.get(
    'SELECT COUNT(*) AS n FROM inspections WHERE inspector_id = @id',
    { id: userId }
  )
  if (inspections > 0) {
    return {
      error:
        'That account has carried out inspections, so it cannot be removed. ' +
        'Create a second admin and reset the password from inside the app instead.',
    }
  }

  await db.batch([
    ...SOFT_REFERENCES.map(([table, column]) =>
      db.stmt(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = @id`, { id: userId })
    ),
    db.stmt('DELETE FROM users WHERE id = @id', { id: userId }),
  ])

  return { ok: true }
}

/** The same thing as SQL, for running through wrangler against a live database. */
export const RELEASE_ADMIN_SQL = [
  ...SOFT_REFERENCES.map(
    ([table, column]) =>
      `UPDATE ${table} SET ${column} = NULL WHERE ${column} IN (SELECT id FROM users WHERE role = 'admin');`
  ),
  "DELETE FROM users WHERE role = 'admin';",
].join(' ')
