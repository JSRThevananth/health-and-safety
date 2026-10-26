/**
 * Configuration, read from the Worker's env rather than process.env.
 *
 * A Worker has no process and no .env file: plain values come from wrangler.jsonc's
 * "vars" and secrets from "wrangler secret put". env is handed to the handler on
 * each request, so this is a function of env rather than a module-level constant.
 */

const bool = (value, fallback = false) =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())

export function readConfig(env) {
  return {
    environment: env.ENVIRONMENT || 'development',
    auth: {
      secret: env.JWT_SECRET || '',
      // 12 hours: longer than a shift, short enough that a lost phone stops working
      // the next day.
      ttlSeconds: Number(env.JWT_TTL_SECONDS || 12 * 60 * 60),
    },
    storage: {
      // "drive", "r2" or "none".
      backend: (env.STORAGE_BACKEND || 'none').toLowerCase(),
      // Drive as the account owner. The only thing that works on a personal
      // Gmail account: a service account has no storage of its own and Google
      // refuses its uploads to a personal My Drive.
      driveClientId: env.GDRIVE_CLIENT_ID || '',
      driveClientSecret: env.GDRIVE_CLIENT_SECRET || '',
      driveRefreshToken: env.GDRIVE_REFRESH_TOKEN || '',
      // Drive as a service account. Workspace shared drives only.
      driveCredentials: env.GDRIVE_CREDENTIALS_JSON || '',
      driveFolderId: env.GDRIVE_FOLDER_ID || '',
    },
    reports: {
      publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
      photoLinkDays: Number(env.REPORT_PHOTO_LINK_DAYS || 30),
    },
    login: {
      maxFailures: Number(env.LOGIN_MAX_FAILURES || 10),
      windowMinutes: Number(env.LOGIN_WINDOW_MINUTES || 15),
    },
  }
}

/**
 * Refuse to serve rather than serve insecurely.
 *
 * Without JWT_SECRET the app would still start and still issue tokens - signed
 * with an empty key, which anyone could forge. A deployment that is missing its
 * secret should be obviously broken, not quietly open.
 */
export function configProblems(config) {
  const problems = []
  if (!config.auth.secret) {
    problems.push('JWT_SECRET is not set. Run: wrangler secret put JWT_SECRET')
  } else if (config.auth.secret.length < 32) {
    problems.push('JWT_SECRET is too short; use at least 32 random characters')
  }
  if (config.storage.backend === 'drive') {
    const oauth =
      config.storage.driveClientId && config.storage.driveClientSecret && config.storage.driveRefreshToken
    if (!oauth && !config.storage.driveCredentials) {
      problems.push(
        'STORAGE_BACKEND is "drive" but no Google credentials are set. Set GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET and GDRIVE_REFRESH_TOKEN (personal Google account), or GDRIVE_CREDENTIALS_JSON (Workspace shared drive).'
      )
    }
    if (!config.storage.driveFolderId) {
      problems.push('STORAGE_BACKEND is "drive" but GDRIVE_FOLDER_ID is not set')
    }
  }
  return problems
}
