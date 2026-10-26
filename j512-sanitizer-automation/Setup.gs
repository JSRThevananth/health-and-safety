/**
 * One-time setup for the J-512 Sanitizer automation.
 *
 * HOW TO USE:
 *   1. Open https://script.google.com while signed in as qasys0020@gmail.com
 *   2. Create a new project, paste in every .gs file from this folder.
 *   3. Run setup() once and approve the authorization prompts.
 *   4. Read the execution log: it prints the live Form URL and the QR-code
 *      file location in Drive. Print the QR code and post it at the refill
 *      station.
 *
 * setup() is safe to re-run: it reuses the Form/Sheet/Folder it already made
 * (their IDs are stored in Script Properties) instead of creating duplicates.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();

  var folder = getOrCreateFolder_(props);
  var form = getOrCreateForm_(props, folder);
  var ss = getOrCreateSpreadsheet_(props, form, folder);

  ensureLogSheet_(ss);
  installTriggers_(form);
  var qrFile = generateQrCode_(form, folder);

  Logger.log('==================================================');
  Logger.log('J-512 Sanitizer automation is ready.');
  Logger.log('Form (give this URL to the QR code): ' + form.getPublishedUrl());
  Logger.log('Form editor: ' + form.getEditUrl());
  Logger.log('Response spreadsheet: ' + ss.getUrl());
  Logger.log('Drive folder: ' + folder.getUrl());
  Logger.log('QR code image: ' + qrFile.getUrl());
  Logger.log('Daily report will be emailed to: ' + REPORT_RECIPIENTS.join(', '));
  Logger.log('Time zone: ' + TIME_ZONE);
  Logger.log('==================================================');
}

function getOrCreateFolder_(props) {
  var id = props.getProperty(PROP_FOLDER_ID);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ }
  }
  var folder = DriveApp.createFolder('J-512 Sanitizer Concentration Logs');
  props.setProperty(PROP_FOLDER_ID, folder.getId());
  return folder;
}

function getOrCreateForm_(props, folder) {
  var id = props.getProperty(PROP_FORM_ID);
  if (id) {
    try { return FormApp.openById(id); } catch (e) { /* fall through */ }
  }

  var form = FormApp.create('J-512 Sanitizer Concentration Log');
  form.setDescription(
    'Scan after refilling a J-512 sanitizer bottle. The time is recorded ' +
    'automatically (24-hour, ' + TIME_ZONE + '). Approved range: ' +
    PPM_MIN + '–' + PPM_MAX + ' ppm.');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);

  var caddyItem = form.addListItem();
  caddyItem.setTitle('Caddy # / Location').setRequired(true)
    .setChoiceValues(CADDY_LOCATIONS);

  var shiftItem = form.addListItem();
  shiftItem.setTitle('Shift').setRequired(true).setChoiceValues(SHIFTS);

  var ppmItem = form.addTextItem();
  ppmItem.setTitle('Concentration (ppm)').setRequired(true);
  var ppmValidation = FormApp.createTextValidation()
    .setHelpText('Enter a number, e.g. 300')
    .requireNumber()
    .build();
  ppmItem.setValidation(ppmValidation);

  var nameItem = form.addTextItem();
  nameItem.setTitle('Employee Name').setRequired(true);

  // Move the form file into the project folder for tidiness.
  try {
    var formFile = DriveApp.getFileById(form.getId());
    folder.addFile(formFile);
    DriveApp.getRootFolder().removeFile(formFile);
  } catch (e) { /* non-fatal */ }

  props.setProperty(PROP_FORM_ID, form.getId());
  return form;
}

function getOrCreateSpreadsheet_(props, form, folder) {
  var id = props.getProperty(PROP_SHEET_ID);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* fall through */ }
  }

  var ss = SpreadsheetApp.create('J-512 Sanitizer Concentration Responses');
  ss.setSpreadsheetTimeZone(TIME_ZONE);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  try {
    var ssFile = DriveApp.getFileById(ss.getId());
    folder.addFile(ssFile);
    DriveApp.getRootFolder().removeFile(ssFile);
  } catch (e) { /* non-fatal */ }

  props.setProperty(PROP_SHEET_ID, ss.getId());
  return ss;
}

/** Creates the clean "Daily Log" tab the report reads from. */
function ensureLogSheet_(ss) {
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Date', 'Time (24h)', 'Caddy # / Location', 'Shift',
      'Concentration (ppm)', 'Employee Name', 'Status', 'Timestamp (ISO)'
    ]);
    sheet.getRange('1:1').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Installs the form-submit and the 23:59 daily-report triggers (idempotent). */
function installTriggers_(form) {
  var wanted = { 'onFormSubmit': true, 'sendDailyReport': true };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (wanted[t.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onFormSubmit')
    .forForm(form)
    .onFormSubmit()
    .create();

  // Runs once per day near 23:59 local time. Apps Script fires clock triggers
  // within a short window of the requested minute.
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(23)
    .nearMinute(59)
    .everyDays(1)
    .inTimezone(TIME_ZONE)
    .create();
}

/**
 * Fetches a QR code that points at the form's public URL and saves it as a
 * PNG in the project folder. Reusable: overwrites nothing, just adds a fresh
 * dated copy if re-run.
 */
function generateQrCode_(form, folder) {
  var url = form.getPublishedUrl();
  var qrApi = 'https://api.qrserver.com/v1/create-qr-code/?size=800x800&margin=20&data=' +
    encodeURIComponent(url);
  var blob = UrlFetchApp.fetch(qrApi).getBlob()
    .setName('J-512 Sanitizer QR Code.png');
  return folder.createFile(blob);
}
