/**
 * End-of-day report.
 *
 * sendDailyReport() is fired by the 23:59 daily trigger. It collects every log
 * row for the current local date, renders a PDF that mirrors the gategroup
 * OPRP-8 J-512 checklist layout, emails it to REPORT_RECIPIENTS, and archives
 * a copy in the Drive folder.
 *
 * You can also run sendDailyReport() manually to test, or
 * sendReportForDate('2026-05-14') to (re)send a specific day.
 */
function sendDailyReport() {
  var today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  sendReportForDate(today);
}

function sendReportForDate(dateStr) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty(PROP_SHEET_ID));
  var folder = DriveApp.getFolderById(props.getProperty(PROP_FOLDER_ID));

  var rows = getLogRowsForDate_(ss, dateStr);
  var html = buildReportHtml_(dateStr, rows);

  var fileName = 'J-512 Sanitizer Concentration Report ' + dateStr + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', fileName).getAs('application/pdf');
  pdf.setName(fileName);

  folder.createFile(pdf);

  var deviations = rows.filter(function (r) { return r.status === 'DEVIATION'; });
  var subject = 'J-512 Sanitizer Concentration Report — ' + dateStr +
    (deviations.length ? ' (' + deviations.length + ' DEVIATION' +
      (deviations.length > 1 ? 'S' : '') + ')' : '');

  var body = 'Automated OPRP-8 J-512 sanitizer concentration report for ' +
    dateStr + ' (' + TIME_ZONE + ').\n\n' +
    'Total logs recorded: ' + rows.length + '\n' +
    'Readings outside ' + PPM_MIN + '–' + PPM_MAX + ' ppm: ' + deviations.length + '\n\n' +
    'The full checklist is attached as a PDF.\n\n' +
    'This message was generated automatically. Do not reply.';

  MailApp.sendEmail({
    to: REPORT_RECIPIENTS.join(','),
    subject: subject,
    body: body,
    attachments: [pdf]
  });

  Logger.log('Report sent for ' + dateStr + ' — ' + rows.length + ' rows, ' +
    deviations.length + ' deviation(s).');
}

/** Returns log rows for the given date as objects. */
function getLogRowsForDate_(ss, dateStr) {
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  var rows = [];
  values.forEach(function (v) {
    var d = v[0];
    // The Date column may be a string or a Date depending on how Sheets stored it.
    var normalized = (d instanceof Date)
      ? Utilities.formatDate(d, TIME_ZONE, 'yyyy-MM-dd')
      : String(d).trim();
    if (normalized !== dateStr) return;
    rows.push({
      date: normalized,
      time: (v[1] instanceof Date)
        ? Utilities.formatDate(v[1], TIME_ZONE, 'HH:mm')
        : String(v[1]).trim(),
      caddy: String(v[2]).trim(),
      shift: String(v[3]).trim(),
      ppm: v[4],
      employee: String(v[5]).trim(),
      status: String(v[6]).trim()
    });
  });
  return rows;
}

/**
 * Builds the HTML that becomes the PDF. Layout follows the gategroup
 * OPRP-8 J-512 checklist: header block, instruction lines, a grid of
 * 19 caddy locations x 3 shifts (TIME / CONCENTRATION / MONITOR each),
 * a Correction/8D column, and the verification footer.
 */
function buildReportHtml_(dateStr, rows) {
  // Index latest entry per caddy+shift.
  var byKey = {};
  rows.forEach(function (r) {
    var key = r.caddy + '||' + normalizeShift_(r.shift);
    // Keep the latest reading of the day for that cell.
    if (!byKey[key] || r.time > byKey[key].time) byKey[key] = r;
  });

  var monthName = formatMonth_(dateStr);
  var SHIFT_KEYS = ['Morning', 'Afternoon', 'Night'];

  var bodyRows = CADDY_LOCATIONS.map(function (caddy) {
    var cells = '<td class="date">' + esc(dateStr) + '</td>' +
      '<td class="caddy">' + esc(caddy) + '</td>';
    var rowHasDeviation = false;

    SHIFT_KEYS.forEach(function (sk) {
      var entry = byKey[caddy + '||' + sk];
      if (entry) {
        var devClass = entry.status === 'DEVIATION' ? ' deviation' : '';
        if (entry.status === 'DEVIATION') rowHasDeviation = true;
        cells += '<td class="time">' + esc(entry.time) + '</td>' +
          '<td class="conc' + devClass + '">' + esc(String(entry.ppm)) + '</td>' +
          '<td class="monitor">' + esc(entry.employee) + '</td>';
      } else {
        cells += '<td class="time"></td><td class="conc"></td><td class="monitor"></td>';
      }
    });

    cells += '<td class="correction">' +
      (rowHasDeviation
        ? 'DEVIATION — retest / discard batch, contact Maintenance (J6)'
        : '') +
      '</td>';
    return '<tr>' + cells + '</tr>';
  }).join('');

  var totalLogs = rows.length;
  var deviationCount = rows.filter(function (r) {
    return r.status === 'DEVIATION';
  }).length;

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>',
    '@page { size: A4 landscape; margin: 14px; }',
    'body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9px; }',
    'table { border-collapse: collapse; width: 100%; }',
    'td, th { border: 1px solid #000; padding: 2px 3px; text-align: center; vertical-align: middle; }',
    '.header-table td { border: 1px solid #000; }',
    '.brand { font-size: 20px; font-weight: bold; }',
    '.title-main { font-weight: bold; font-size: 11px; }',
    '.title-sub { font-weight: bold; font-size: 10px; }',
    '.shiftbox { font-weight: bold; font-size: 10px; }',
    '.instructions { font-weight: bold; font-size: 9px; text-align: left; padding: 3px 5px; }',
    'th { background: #f0f0f0; font-size: 8.5px; }',
    '.date, .caddy { font-weight: bold; }',
    '.caddy { background: #fafafa; }',
    '.conc.deviation { background: #f8c9c9; font-weight: bold; }',
    '.correction { text-align: left; font-size: 8px; color: #b00; font-weight: bold; }',
    '.footer { margin-top: 8px; font-size: 8.5px; }',
    '.footer td { border: 1px solid #000; text-align: left; padding: 6px 5px; }',
    '.docmeta { margin-top: 6px; font-size: 7px; color: #333; }',
    '.summary { margin-top: 6px; font-size: 9px; font-weight: bold; }',
    '</style></head><body>',

    // ---- Header block ----
    '<table class="header-table"><tr>',
    '<td style="width:22%"><span class="brand">gategroup&trade;</span></td>',
    '<td style="width:52%"><div class="title-main">OPRP 8 J-512 BOTTLES</div>',
    '<div class="title-sub">Checklist OPRP-8 Sanitizer Concentration&ndash;J512</div></td>',
    '<td style="width:26%"><div class="shiftbox">SHIFT - &#9744; 1ST &nbsp; &#9744; 2ND &nbsp; &#9744; 3RD</div>',
    '<div class="shiftbox">Month : ' + esc(monthName) + '</div></td>',
    '</tr>',
    '<tr><td colspan="3" class="instructions">' +
      '1. Use Approved Sanitizer and check once per shift (8 hours approximate) while in use. J9</td></tr>',
    '<tr><td colspan="3" class="instructions">' +
      '2. In case of deviation discard batch / retest and contact Maintenance for follow up. J6</td></tr>',
    '</table>',

    // ---- Main grid ----
    '<table>',
    '<tr>',
    '<th rowspan="2">DATE</th><th rowspan="2">CADDY #</th>',
    '<th colspan="3">Morning Shift</th>',
    '<th colspan="3">Afternoon Shift</th>',
    '<th colspan="3">Night Shift</th>',
    '<th rowspan="2">Correction / 8D</th>',
    '</tr>',
    '<tr>',
    '<th>TIME</th><th>CONCENTRATION<br>(' + PPM_MIN + ' - ' + PPM_MAX + ' ppm)</th><th>MONITOR</th>',
    '<th>TIME</th><th>CONCENTRATION<br>(' + PPM_MIN + ' - ' + PPM_MAX + ' ppm)</th><th>MONITOR</th>',
    '<th>TIME</th><th>CONCENTRATION<br>(' + PPM_MIN + ' - ' + PPM_MAX + ' ppm)</th><th>MONITOR</th>',
    '</tr>',
    bodyRows,
    '</table>',

    '<div class="summary">Logs recorded: ' + totalLogs +
      ' &nbsp;|&nbsp; Deviations (outside ' + PPM_MIN + '&ndash;' + PPM_MAX +
      ' ppm): ' + deviationCount + '</div>',

    // ---- Verification footer ----
    '<table class="footer">',
    '<tr><td style="width:60%">I have reviewed and verified the above OPRP8 log for accuracy and completeness.</td>',
    '<td>Sig - ____________________</td><td>Date - ___ / ___ / ______</td></tr>',
    '<tr><td>Record Review Verification Signature</td><td></td><td></td></tr>',
    '<tr><td>Management Verification Signature</td>',
    '<td>Sig - ____________________</td><td>Date - ___ / ___ / ______</td></tr>',
    '</table>',

    '<div class="docmeta">XF.1402.10.02080-6 Rev. February 28, 2026<br>',
    'This document is proprietary and strictly confidential. It is intended for the use of covered persons who are the authorized recipients ',
    'and is not intended for distribution outside gategroup without authorized approval. ',
    'This Policy can only be modified or altered by its owner in compliance with the applicable rules governing Policy Management within gategroup.<br>',
    'Report generated automatically on ' +
      Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm') +
      ' (' + TIME_ZONE + ').</div>',

    '</body></html>'
  ].join('');
}

/** Collapses "Morning Shift" / "morning" / etc. to a canonical key. */
function normalizeShift_(shift) {
  var s = String(shift).toLowerCase();
  if (s.indexOf('morning') > -1) return 'Morning';
  if (s.indexOf('afternoon') > -1) return 'Afternoon';
  if (s.indexOf('night') > -1) return 'Night';
  return shift;
}

/** "2026-05-14" -> "May 2026" */
function formatMonth_(dateStr) {
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
  return Utilities.formatDate(d, TIME_ZONE, 'MMMM yyyy');
}

/** Minimal HTML escaping for cell content. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
