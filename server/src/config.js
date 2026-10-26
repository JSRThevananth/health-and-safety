import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const bool = (value, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())

export const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 8000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((o) => o.trim()),
  // Enable when running behind a hosting platform's proxy so the real client IP
  // reaches the rate limiter.
  trustProxy: bool(process.env.TRUST_PROXY, false),

  db: {
    file: process.env.DATABASE_FILE || path.join(rootDir, 'data', 'qa.db'),
  },

  auth: {
    // Never ship the fallback: start-up refuses to boot with it when NODE_ENV=production.
    jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    tokenTtl: process.env.JWT_TTL || '12h',
  },

  brevo: {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || '',
    senderName: process.env.BREVO_SENDER_NAME || 'QA Platform',
    // When false, alerts are logged instead of sent. Keeps local dev at zero quota cost.
    enabled: bool(process.env.BREVO_ENABLED, false),
  },

  drive: {
    // Service-account JSON, either as a path or inlined (for hosts that only offer env vars).
    credentialsFile: process.env.GDRIVE_CREDENTIALS_FILE || '',
    credentialsJson: process.env.GDRIVE_CREDENTIALS_JSON || '',
    folderId: process.env.GDRIVE_FOLDER_ID || '',
    enabled: bool(process.env.GDRIVE_ENABLED, false),
    localFallbackDir: process.env.LOCAL_UPLOAD_DIR || path.join(rootDir, 'data', 'uploads'),
  },
}

export function assertProductionConfig() {
  if (config.env !== 'production') return
  const problems = []
  if (config.auth.jwtSecret === 'dev-only-insecure-secret') problems.push('JWT_SECRET must be set in production')
  if (config.corsOrigins.includes('*')) {
    problems.push('CORS_ORIGINS must name the real site in production, not "*"')
  }
  if (config.corsOrigins.some((o) => o.startsWith('http://localhost'))) {
    problems.push('CORS_ORIGINS still points at localhost - set it to the deployed site')
  }
  if (config.brevo.enabled && !config.brevo.apiKey) problems.push('BREVO_API_KEY is required when BREVO_ENABLED=true')
  if (config.drive.enabled && !config.drive.credentialsFile && !config.drive.credentialsJson) {
    problems.push('GDRIVE_CREDENTIALS_FILE or GDRIVE_CREDENTIALS_JSON is required when GDRIVE_ENABLED=true')
  }
  if (problems.length) throw new Error(`Invalid production config:\n  - ${problems.join('\n  - ')}`)
}
