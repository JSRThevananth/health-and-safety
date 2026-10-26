import { createApp } from './app.js'
import { createDb } from './db.js'
import { readConfig } from './config.js'
import { purgePhotos, archiveNotes, pruneLoginAttempts } from './services/retention.js'
import { rebuildMonthlySheets } from './services/monthlySheet.js'
import { sendOverdueDigest } from './services/digest.js'

const app = createApp()

/**
 * The morning digest's schedule, as wrangler.jsonc declares it.
 *
 * 11:45 UTC is quarter to eight in Montreal: before the first shift settles,
 * after somebody has opened their laptop. Weekdays only - an overdue action
 * chased on a Sunday is read on Monday anyway, and a weekend email that can
 * never be acted on is how people learn to ignore the weekday ones.
 */
const DIGEST_CRON = '45 11 * * 1-5'

export default {
  /**
   * Every request arrives here, but only /api/* actually reaches this code:
   * wrangler.jsonc serves the React build for everything else and falls back to
   * index.html so client-side routes resolve.
   */
  fetch: app.fetch,

  /**
   * The nightly cron (see "triggers" in wrangler.jsonc).
   *
   * Errors are caught and logged rather than thrown: a failed purge must not look
   * like a failed deploy, and the next night's run picks up whatever was missed.
   */
  async scheduled(event, env, ctx) {
    const db = createDb(env.DB)
    const config = readConfig(env)

    /*
     * Two triggers, deliberately, rather than one job that does everything.
     *
     * A Worker gets 50 subrequests per invocation and the nightly sweep already
     * uses about 38 of them; adding the digest would mean one of the two
     * silently doing nothing on a busy day. Separate crons get separate
     * budgets - and the digest wants to arrive in the morning anyway, not at
     * three in the morning with the housekeeping.
     */
    if (event.cron === DIGEST_CRON) {
      ctx.waitUntil(
        (async () => {
          try {
            const digest = await sendOverdueDigest(db, config)
            console.log('[cron]', JSON.stringify({ cron: event.cron, digest }))
          } catch (error) {
            console.error('[cron] digest failed:', error?.stack || error)
          }
        })()
      )
      return
    }

    ctx.waitUntil(
      (async () => {
        try {
          const photos = await purgePhotos(env, config, db)
          const notes = await archiveNotes(db)
          const attempts = await pruneLoginAttempts(db, config.login.windowMinutes)
          // Last, and after the purge: the sheet reports how many photos a
          // finding still has, so it should be written knowing tonight's purge
          // has already happened.
          const sheets = await rebuildMonthlySheets(env, config, db)
          console.log('[cron]', JSON.stringify({ cron: event.cron, photos, notes, attempts, sheets }))
        } catch (error) {
          console.error('[cron] retention sweep failed:', error?.stack || error)
        }
      })()
    )
  },
}
