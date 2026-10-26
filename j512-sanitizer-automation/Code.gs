/**
 * Form-submit handler.
 *
 * Fires every time an employee submits the J-512 Sanitizer Concentration Log
 * form (i.e. after scanning the QR code). It stamps the current local time in
 * 24-hour format, classifies the reading against the approved ppm window, and
 * appends a clean row to the "Daily Log" sheet that the report reads from.
 */
function onFormSubmit(e) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty(PROP_SHEET_ID));
  var sheet = ss.getSheetByName(LOG_SHEET_NAME) || ensureLogSheet_(ss);

  var answers = readResponse_(e);

  // Authoritative timestamp: server time, rendered in the configured zone.
  var now = new Date();
  var dateStr = Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd');
  var timeStr = Utilities.formatDate(now, TIME_ZONE, 'HH:mm'); // 24-hour
  var isoStr = Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");

  var ppm = parseFloat(answers['Concentration (ppm)']);
  var status = classifyPpm_(ppm);

  sheet.appendRow([
    dateStr,
    timeStr,
    answers['Caddy # / Location'] || '',
    answers['Shift'] || '',
    isNaN(ppm) ? answers['Concentration (ppm)'] : ppm,
    answers['Employee Name'] || '',
    status,
    isoStr
  ]);
}

/** Maps a ppm reading to "OK" or "DEVIATION" (used in the Correction/8D column). */
function classifyPpm_(ppm) {
  if (isNaN(ppm)) return 'INVALID';
  if (ppm < PPM_MIN || ppm > PPM_MAX) return 'DEVIATION';
  return 'OK';
}

/**
 * Normalizes a form-submit event into a { questionTitle: answer } map.
 * Works whether the trigger delivers e.response (FormApp) or e.namedValues.
 */
function readResponse_(e) {
  var out = {};
  if (e && e.response && typeof e.response.getItemResponses === 'function') {
    e.response.getItemResponses().forEach(function (ir) {
      out[ir.getItem().getTitle()] = ir.getResponse();
    });
  } else if (e && e.namedValues) {
    Object.keys(e.namedValues).forEach(function (k) {
      var v = e.namedValues[k];
      out[k] = Array.isArray(v) ? v.join(', ') : v;
    });
  }
  return out;
}
