/**
 * Configuration.
 *
 * Values live in Script Properties rather than in this file, so a secret is never
 * committed and a key can be rotated without a code change. Set them from the Apps
 * Script editor: Project Settings -> Script Properties.
 */
function getConfig() {
  const p = PropertiesService.getScriptProperties().getProperties();

  return {
    spreadsheetId: p.SPREADSHEET_ID || '',
    driveFolderId: p.DRIVE_FOLDER_ID || '',

    // Signs session tokens. Anyone holding it could forge a sign-in, so it is
    // generated once by setUp() and never checked into the repository.
    tokenSecret: p.TOKEN_SECRET || '',

    brevo: {
      apiKey: p.BREVO_API_KEY || '',
      senderEmail: p.BREVO_SENDER_EMAIL || '',
      senderName: p.BREVO_SENDER_NAME || 'Health & Safety',
      // Off by default: email is recorded but not sent, so development costs no quota.
      enabled: String(p.BREVO_ENABLED || 'false').toLowerCase() === 'true',
    },

    sessionHours: Number(p.SESSION_HOURS || 12),
    minPasswordLength: Number(p.MIN_PASSWORD_LENGTH || 8),

    noteRetentionDays: Number(p.NOTE_RETENTION_DAYS || 30),
    photoRetentionDays: Number(p.PHOTO_RETENTION_DAYS || 14),
  };
}

function setConfigValue(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

/** Fail loudly at the point of use rather than producing a confusing error later. */
function requireConfig(keys) {
  const config = getConfig();
  const missing = [];
  if (keys.indexOf('spreadsheetId') !== -1 && !config.spreadsheetId) missing.push('SPREADSHEET_ID');
  if (keys.indexOf('driveFolderId') !== -1 && !config.driveFolderId) missing.push('DRIVE_FOLDER_ID');
  if (keys.indexOf('tokenSecret') !== -1 && !config.tokenSecret) missing.push('TOKEN_SECRET');
  if (missing.length > 0) {
    throw new Error('Missing Script Properties: ' + missing.join(', ') + '. Run setUp() first.');
  }
  return config;
}
