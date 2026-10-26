import { createApp } from './app.js'
import { createDb } from './db.js'
import { readConfig } from './config.js'
import { purgePhotos, archiveNotes, pruneLoginAttempts } from './services/retention.js'
import { rebuildMonthlySheets } from './services/monthlySheet.js'

const app = createApp()

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
