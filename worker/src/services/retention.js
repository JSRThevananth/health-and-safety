import { now } from '../db.js'
import { deleteFile } from './storage.js'

/**
 * Retention.
 *
 * Photos are the bulk of the storage and the least durable evidence: the report
 * carrying them has already been emailed, so after the window they are deleted
 * from the object store. The attachment row stays behind as a tombstone, so an
 * auditor opening an old inspection sees "purged on <date> under <policy>" rather
 * than a broken image.
 *
 * Notes are archived on their own, longer window - they are what repeat-finding
 * detection reads, so they are hidden from normal views rather than deleted.
 *
 * Ratings and the inspection history are never purged. They are small, and they
 * are the whole point of having a database rather than a pile of emails.
 */

/**
 * The most photos one nightly run will purge.
 *
 * Bounded by the platform, not by taste: a Worker gets 50 subrequests per
 * invocation on the free plan, and a cron trigger is an invocation. Each photo
 * costs one Drive delete; the database updates are collected into a single
 * batch so they cost one between them.
 *
 * 20 rather than the whole budget because the same nightly run also rebuilds
 * the monthly sheets, and the two have to fit in those 50 between them. A
 * backlog larger than this is cleared over consecutive nights, which is the
 * right trade: retention is a policy measured in weeks, and a purge that
 * exceeds its budget deletes nothing at all.
 */
export const MAX_PHOTOS_PER_RUN = 20

export async function purgePhotos(env, config, db, { dryRun = false } = {}) {
  const tenants = await db.all('SELECT id, photo_retention_days FROM tenants WHERE active = 1')
  const report = { examined: 0, purged: 0, failed: 0, remaining: 0, dryRun }

  let budget = MAX_PHOTOS_PER_RUN
  const purged = []

  for (const tenant of tenants) {
    if (budget <= 0) break
    const cutoff = daysAgo(tenant.photo_retention_days)

    // Scoped to the tenant through the inspection that owns the attachment, so
    // one customer's retention window never reaches another's evidence.
    // One row over the budget, purely to report whether a backlog remains.
    const due = await db.all(
      `SELECT a.* FROM attachments a
       JOIN inspections i ON i.id = a.entity_id AND a.entity_type = 'inspection'
       JOIN units u ON u.id = i.unit_id
       WHERE u.tenant_id = @tenant
         AND a.purged_at IS NULL
         AND a.mime_type LIKE 'image/%'
         AND a.created_at < @cutoff
       ORDER BY a.created_at
       LIMIT @limit`,
      { tenant: tenant.id, cutoff, limit: budget + 1 }
    )

    if (due.length > budget) {
      report.remaining += due.length - budget
      due.length = budget
    }

    report.examined += due.length
    if (dryRun) continue

    for (const attachment of due) {
      try {
        await deleteFile(env, config, attachment)
        purged.push({
          id: attachment.id,
          policy: `photo retention: ${tenant.photo_retention_days} days`,
        })
        budget -= 1
      } catch (error) {
        // One unreachable object must not stop the sweep. purged_at stays
        // empty, so the next run tries again.
        console.error(`[retention] could not purge attachment ${attachment.id}:`, error.message)
        report.failed += 1
        budget -= 1
      }
    }
  }

  // Every tombstone in one batch: 40 individual updates would cost 40 of the
  // 50 subrequests on their own.
  if (purged.length) {
    const at = now()
    await db.batch(
      purged.map((row) =>
        db.stmt('UPDATE attachments SET purged_at = @at, purge_policy = @policy WHERE id = @id', {
          at,
          policy: row.policy,
          id: row.id,
        })
      )
    )
    report.purged = purged.length
  }

  return report
}

export async function archiveNotes(db, { dryRun = false } = {}) {
  const tenants = await db.all('SELECT id, note_retention_days FROM tenants WHERE active = 1')
  const report = { archived: 0, dryRun }

  for (const tenant of tenants) {
    const cutoff = daysAgo(tenant.note_retention_days)
    const { n } = await db.get(
      `SELECT COUNT(*) AS n FROM inspection_items
       WHERE note <> '' AND inspection_id IN (
         SELECT i.id FROM inspections i JOIN units u ON u.id = i.unit_id
         WHERE u.tenant_id = @tenant AND i.status = 'signed' AND i.signed_at < @cutoff
       )`,
      { tenant: tenant.id, cutoff }
    )
    report.archived += n
  }

  // Deliberately a count, not a delete. Free-text notes are the evidence an
  // auditor asks for; the window is enforced on what the UI shows, and a real
  // deletion gets its own explicit, logged action rather than a nightly cron.
  return report
}

/** Sign-in attempt rows are only useful inside the throttle window. */
export async function pruneLoginAttempts(db, windowMinutes) {
  const cutoff = new Date(Date.now() - windowMinutes * 60_000 * 4).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const { changes } = await db.run('DELETE FROM login_attempts WHERE created_at < @cutoff', { cutoff })
  return { deleted: changes }
}

const daysAgo = (days) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
