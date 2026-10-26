/**
 * First-run setup.
 *
 * Run setUp() once from the Apps Script editor. It creates the spreadsheet and the
 * Drive folder, installs the checklist, and creates the first administrator.
 * Safe to run again: existing data is left alone.
 */

function setUp() {
  const properties = PropertiesService.getScriptProperties();
  const log = [];

  // 1. The data spreadsheet.
  let spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    const created = SpreadsheetApp.create('Health & Safety Platform - Data');
    spreadsheetId = created.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
    log.push('Created data spreadsheet: ' + created.getUrl());
  } else {
    log.push('Using existing spreadsheet.');
  }

  // 2. The token signing secret. Generated here so it is never in the source.
  if (!properties.getProperty('TOKEN_SECRET')) {
    properties.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('Generated a token signing secret.');
  }

  // 3. Our own Drive folder. The drive.file scope only reaches files this script
  //    created, so it has to make its own rather than be given one.
  let folderId = properties.getProperty('DRIVE_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('Health & Safety Evidence');
    folderId = folder.getId();
    properties.setProperty('DRIVE_FOLDER_ID', folderId);
    log.push('Created evidence folder: ' + folder.getUrl());
  }

  // 4. Tabs.
  const schema = ensureSchema();
  log.push('Tables ready: ' + schema.tables + (schema.created.length ? ' (created ' + schema.created.length + ')' : ''));

  // 5. Organisation, first unit, checklist and first administrator.
  let tenant = dbFirst('Tenants', function () { return true; });
  if (!tenant) {
    tenant = dbTransaction(function () {
      return dbInsert('Tenants', {
        name: 'Gate Gourmet', slug: 'gategourmet', active: 1,
        note_retention_days: 30, photo_retention_days: 14,
        created_at: new Date().toISOString(),
      });
    });
    log.push('Created organisation.');
  }

  const library = installLibrary(tenant.id);
  if (library.items > 0) log.push('Installed checklist: ' + library.items + ' items.');

  let unit = dbFirst('Units', function (u) { return Number(u.tenant_id) === Number(tenant.id); });
  if (!unit) {
    unit = dbTransaction(function () {
      return dbInsert('Units', {
        tenant_id: tenant.id, name: 'Montreal', code: 'YUL',
        location: 'Montreal, Canada', timezone: 'America/Toronto', active: 1,
        created_at: new Date().toISOString(),
      });
    });
    log.push('Created first unit: Montreal (YUL).');
  }

  if (!getPublishedTemplate(unit.id)) {
    publishDraft(createDraft(unit.id, tenant.id, 0).id);
    log.push('Published checklist v1 for the first unit.');
  }

  let admin = dbFirst('Users', function (u) { return u.role === 'omni_admin'; });
  let temporaryPassword = null;
  if (!admin) {
    // Random, shown once, and must be replaced on first sign-in. Never a value
    // written into the source where it would live in the repository forever.
    temporaryPassword = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
    const salt = generateSalt();
    admin = dbTransaction(function () {
      return dbInsert('Users', {
        tenant_id: tenant.id, username: 'admin', email: '',
        full_name: 'Administrator', initials: 'A', role: 'omni_admin',
        password_salt: salt, password_hash: hashPassword(temporaryPassword, salt),
        must_change_password: 1, active: 1, created_at: new Date().toISOString(),
      });
    });
  }

  const url = ScriptApp.getService().getUrl();
  const banner = [
    '',
    '========================================================',
    ' SETUP COMPLETE',
    '========================================================',
    '',
  ].concat(log.map(function (l) { return '  ' + l; }));

  if (temporaryPassword) {
    banner.push(
      '',
      '  FIRST SIGN-IN',
      '    username: admin',
      '    password: ' + temporaryPassword,
      '',
      '  This password is shown once and cannot be recovered.',
      '  Copy it now. You must change it at first sign-in.'
    );
  } else {
    banner.push('', '  An administrator already exists; no new password issued.');
  }

  banner.push('', '  Web app: ' + (url || 'deploy it first: Deploy > New deployment'), '');
  const text = banner.join('\n');
  Logger.log(text);
  return text;
}

/**
 * Issue a new temporary password for a user who is locked out.
 * Run from the editor: resetPassword('username').
 */
function resetPassword(username) {
  const user = dbFirst('Users', function (u) {
    return String(u.username).toLowerCase() === String(username).toLowerCase();
  });
  if (!user) throw new Error('No such user: ' + username);

  const temporary = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
  const salt = generateSalt();
  dbTransaction(function () {
    dbUpdate('Users', user.id, {
      password_salt: salt,
      password_hash: hashPassword(temporary, salt),
      must_change_password: 1,
      password_changed_at: '',
    });
  });

  const message = 'Temporary password for ' + user.username + ': ' + temporary
    + '\nThey must change it at next sign-in.';
  Logger.log(message);
  return message;
}

/**
 * Install the scheduled jobs. Run once, after setUp().
 * Existing triggers for these functions are replaced rather than duplicated.
 */
function installTriggers() {
  const wanted = ['dailyOverdueCheck', 'monthlyReport', 'purgePhotosJob'];
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (wanted.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('dailyOverdueCheck').timeBased().atHour(7).everyDays(1).create();
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(6).create();
  ScriptApp.newTrigger('purgePhotosJob').timeBased().atHour(3).everyDays(1).create();

  return 'Scheduled: daily overdue check (07:00), monthly report (1st, 06:00), photo purge (03:00).';
}

function purgePhotosJob() {
  const result = purgePhotos(false);
  Logger.log('Photo purge: ' + JSON.stringify(result));
}

function dailyOverdueCheck() {
  // Corrective actions are not built yet; the trigger exists so the schedule is in
  // place and this becomes a one-line change rather than a setup step later.
  Logger.log('Daily overdue check: corrective actions not yet implemented.');
}

function monthlyReport() {
  Logger.log('Monthly report: not yet implemented.');
}
