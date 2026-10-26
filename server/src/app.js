import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { config } from './config.js'
import { getDb } from './db/index.js'
import { requireAuth, requirePasswordChanged } from './middleware/auth.js'
import { notFound, errorHandler } from './middleware/errors.js'
import authRoutes from './routes/auth.js'
import attachmentRoutes from './routes/attachments.js'
import notificationRoutes from './routes/notifications.js'
import unitRoutes from './routes/units.js'
import userRoutes from './routes/users.js'
import templateRoutes from './routes/templates.js'
import inspectionRoutes from './routes/inspections.js'

export function createApp() {
  const app = express()

  // Behind a hosting proxy (Render, Fly, Railway) the client IP arrives in
  // X-Forwarded-For. Without this every request looks like one address and the
  // rate limiter below would throttle all users together.
  if (config.trustProxy) app.set('trust proxy', 1)

  app.use(helmet())
  app.use(compression())

  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    })
  )
  app.use(express.json({ limit: '1mb' }))

  // Sign-in is the one unauthenticated route that reveals whether a guess was
  // right, so it is the one worth throttling. Counted per IP.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Only failed attempts count, so a busy shared office is not locked out.
    skipSuccessfulRequests: true,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  })

  // A wider net for everything else, to blunt scraping and accidental loops.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Slow down and try again shortly.' },
  })

  app.use('/auth/login', loginLimiter)
  app.use(apiLimiter)

  app.get('/health', (req, res) => {
    getDb().prepare('SELECT 1').get()
    res.json({
      status: 'ok',
      env: config.env,
      email: config.brevo.enabled ? 'brevo' : 'dry-run',
      storage: config.drive.enabled ? 'gdrive' : 'local',
    })
  })

  app.use('/auth', authRoutes)

  // Everything past this point requires a valid bearer token, and a password the
  // user chose themselves rather than the temporary one an admin issued.
  app.use(requireAuth)
  app.use(requirePasswordChanged)
  app.use('/units/:unit_id/template', templateRoutes)
  app.use('/inspections', inspectionRoutes)
  app.use('/units', unitRoutes)
  app.use('/users', userRoutes)
  app.use('/attachments', attachmentRoutes)
  app.use('/notifications', notificationRoutes)
  // Domain routes get mounted here once we know what the app does.

  app.use(notFound)
  app.use(errorHandler)
  return app
}
