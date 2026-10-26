/**
 * J-512 Sanitizer Concentration Check — Automation
 * Configuration constants shared across the project.
 *
 * Host account: qasys0020@gmail.com
 */

// IANA time zone for all timestamps and the daily send time.
// "America/Toronto" covers Montreal / Quebec (handles EST/EDT automatically).
var TIME_ZONE = 'America/Toronto';

// Where the end-of-day PDF report is sent (23:59 local time).
var REPORT_RECIPIENTS = ['qasys0020@gmail.com'];

// Approved J-512 concentration window, in ppm. Anything outside is a deviation.
var PPM_MIN = 200;
var PPM_MAX = 400;

// The 19 caddy locations from the gategroup OPRP-8 checklist, in printed order.
var CADDY_LOCATIONS = [
  'Hot kitchen 1',
  'Hot kitchen 2',
  'CRA 1',
  'CRA 2',
  'M&P 1',
  'M&P 2',
  '6',
  '7',
  '8',
  '9',
  '10',
  'Allergen 1',
  'Allergen 2',
  'W&P 1',
  'W&P 2',
  'P&P 1',
  'P&P 2',
  'INBOUND',
  'OUTBOUND'
];

// The three shifts tracked by the checklist.
var SHIFTS = ['Morning Shift', 'Afternoon Shift', 'Night Shift'];

// Sheet (tab) name that stores one row per QR scan / refill log.
var LOG_SHEET_NAME = 'Daily Log';

// Script Property keys used to remember the resources setup() creates.
var PROP_FORM_ID = 'FORM_ID';
var PROP_SHEET_ID = 'SPREADSHEET_ID';
var PROP_FOLDER_ID = 'DRIVE_FOLDER_ID';
