import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { createDb } from './db.js'
import { readConfig, configProblems } from './config.js'
import { onError, notFound, fail } from './middleware/errors.js'
import { requireAuth, requirePasswordChanged } from './middleware/auth.js'
import authRoutes from './routes/auth.js'
import unitRoutes from './routes/units.js'
import userRoutes from './routes/users.js'
import templateRoutes from './routes/templates.js'
import inspectionRoutes from './routes/inspections.js'
import attachmentRoutes from './routes/attachments.js'
import notificationRoutes from './routes/notifications.js'
import setupRoutes from './routes/setup.js'
import recipientRoutes from './routes/recipients.js'
import reportRoutes from './routes/reports.js'
import photoRoutes from './routes/photos.js'
import exportRoutes from './routes/exports.js'
import capaRoutes from './routes/capas.js'
import kpiRoutes from './routes/kpis.js'
import { storageBackend } from './services/storage.js'

/**
 * The API.
 *
 * Everything is mounted under /api because the same Worker also serves the React
 * build: wrangler.jsonc sends /api/* here and lets every other path fall through
 * to the static assets. One origin for both means no CORS layer to configure and
 * no second domain to keep in step.
 */
export function createApp() {
  const app = new Hono().basePath('/api')

  app.onError(onError)
  app.notFound(notFound)

  app.use('*', secureHeaders())

  // The database handle and config are per-request: a Worker is handed its
  // bindings with each request rather than reading an environment at start-up.
  app.use('*', async (c, next) => {
    c.set('db', createDb(c.env.DB))
    c.set('config', readConfig(c.env))
    await next()
  })

  app.get('/health', async (c) => {
    const config = c.get('config')
    const problems = configProblems(config)

    // Prove the database is actually reachable rather than just that the Worker
    // started; a missing D1 binding otherwise only shows up on the first sign-in.
    let database = 'ok'
    try {
      await c.get('db').get('SELECT 1 AS ok')
    } catch (error) {
      database = `unreachable: ${error.message}`
    }

    const healthy = problems.length === 0 && database === 'ok'
    return c.json(
      {
        status: healthy ? 'ok' : 'degraded',
        env: config.environment,
        database,
        email: config.brevo.enabled ? 'brevo' : 'dry-run',
        storage: storageBackend(config),
        // Named, not described in prose: whoever reads this is trying to fix it.
        problems,
      },
      healthy ? 200 : 503
    )
  })

  /*
   * A deployment with no signing secret would still issue tokens - signed with an
   * empty key, which anyone could forge. Refuse until the secret is set, rather
   * than appear to work.
   *
   * Setup is covered too: it can only be run once, and a half-configured
   * deployment must not be able to spend that one chance.
   */
  const requireSigningSecret = async (c, next) => {
    if (!c.get('config').auth.secret) {
      throw fail(503, 'This deployment is not finished: JWT_SECRET is not set. See /api/health.')
    }
    await next()
  }
  app.use('/auth/*', requireSigningSecret)
  app.use('/setup/*', requireSigningSecret)

  // First-run bootstrap. Unauthenticated by necessity - there is no account yet -
  // and it refuses the moment one exists.
  app.route('/setup', setupRoutes)

  // Photos for an emailed report. Unauthenticated by necessity - an email client
  // cannot send a bearer token - and gated instead by a signed, expiring token
  // naming one attachment.
  app.route('/photos', photoRoutes)

  app.route('/auth', authRoutes)

  // Everything past this point requires a valid bearer token, and a password the
  // user chose themselves rather than the temporary one an admin issued.
  app.use('/units/*', requireAuth, requirePasswordChanged)
  app.use('/inspections/*', requireAuth, requirePasswordChanged)
  app.use('/users/*', requireAuth, requirePasswordChanged)
  app.use('/attachments/*', requireAuth, requirePasswordChanged)
  app.use('/notifications/*', requireAuth, requirePasswordChanged)
  app.use('/capas/*', requireAuth, requirePasswordChanged)
  app.use('/kpis/*', requireAuth, requirePasswordChanged)

  // Mounted before /units so the more specific paths win.
  app.route('/units/:unit_id/template', templateRoutes)
  app.route('/units/:unit_id/recipients', recipientRoutes)
  app.route('/units/:unit_id/exports', exportRoutes)
  app.route('/units', unitRoutes)
  app.route('/inspections', reportRoutes)
  app.route('/inspections', inspectionRoutes)
  app.route('/users', userRoutes)
  app.route('/attachments', attachmentRoutes)
  app.route('/capas', capaRoutes)
  app.route('/kpis', kpiRoutes)
  app.route('/notifications', notificationRoutes)

  return app
}
