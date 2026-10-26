/**
 * Table definitions.
 *
 * Each entry becomes one tab in the spreadsheet, with the listed columns as its
 * header row. Column order is fixed once data exists: rows are read positionally,
 * so inserting a column in the middle would silently shift every value.
 * Add new columns at the end only.
 */
const SCHEMA = {
  Tenants: ['id', 'name', 'slug', 'active', 'note_retention_days', 'photo_retention_days', 'created_at'],

  Units: ['id', 'tenant_id', 'name', 'code', 'location', 'timezone', 'active', 'created_at'],

  Users: [
    'id', 'tenant_id', 'username', 'email', 'full_name', 'initials', 'role',
    'password_hash', 'password_salt', 'must_change_password', 'password_changed_at',
    'active', 'created_at',
  ],

  UserUnits: ['id', 'user_id', 'unit_id'],

  UserPermissions: ['id', 'user_id', 'permission', 'granted'],

  LibrarySections: ['id', 'tenant_id', 'code', 'title', 'applies_to', 'sort_order'],

  LibraryGroups: ['id', 'section_id', 'code', 'title', 'sort_order'],

  LibraryItems: ['id', 'group_id', 'code', 'text', 'risk_weight', 'sort_order', 'active'],

  UnitCustomItems: [
    'id', 'unit_id', 'section_id', 'group_id', 'text', 'risk_weight', 'active',
    'created_by', 'created_at',
  ],

  UnitTemplates: [
    'id', 'unit_id', 'version', 'status', 'notes', 'created_by', 'created_at', 'published_at',
  ],

  UnitTemplateSections: ['id', 'template_id', 'section_id', 'enabled', 'sort_order'],

  UnitTemplateItems: [
    'id', 'template_id', 'library_item_id', 'custom_item_id', 'text_override',
    'enabled', 'risk_weight', 'sort_order',
  ],

  Inspections: [
    'id', 'unit_id', 'template_id', 'inspector_id', 'status', 'department', 'shift',
    'summary', 'started_at', 'updated_at', 'submitted_at', 'signed_at', 'signed_by',
  ],

  // Only items the inspector actually touched are stored. Everything else is
  // satisfactory by definition, so an untouched 303-point inspection costs no rows.
  InspectionItems: ['id', 'inspection_id', 'template_item_id', 'rating', 'note', 'updated_at'],

  Attachments: [
    'id', 'entity_type', 'entity_id', 'filename', 'mime_type', 'size_bytes',
    'drive_file_id', 'web_view_link', 'uploaded_by', 'created_at', 'purged_at', 'purge_policy',
  ],

  Recipients: ['id', 'unit_id', 'email', 'name', 'report_types', 'active', 'created_at'],

  EmailLog: ['id', 'template', 'recipients', 'subject', 'status', 'detail', 'created_at'],

  Sessions: ['id', 'token', 'user_id', 'created_at', 'expires_at'],
};

/** Tabs that should never be visible to a person who opens the spreadsheet. */
const HIDDEN_TABS = ['Sessions', 'Users'];

/**
 * Create any missing tabs and header rows. Safe to run repeatedly: existing tabs
 * and their data are left alone, and only genuinely new columns are appended.
 */
function ensureSchema() {
  const ss = SpreadsheetApp.openById(getConfig().spreadsheetId);
  const created = [];

  Object.keys(SCHEMA).forEach(function (name) {
    const columns = SCHEMA[name];
    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
      created.push(name);
      if (HIDDEN_TABS.indexOf(name) !== -1) sheet.hideSheet();
      return;
    }

    // Append columns added by a later release, without disturbing existing data.
    const width = Math.max(sheet.getLastColumn(), 1);
    const header = sheet.getRange(1, 1, 1, width).getValues()[0].filter(String);
    const missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
    if (missing.length > 0) {
      sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, 1, 1, header.length + missing.length).setFontWeight('bold');
    }
  });

  // Google always leaves a default sheet behind on a new spreadsheet.
  const leftover = ss.getSheetByName('Sheet1');
  if (leftover && ss.getSheets().length > 1 && leftover.getLastRow() === 0) {
    ss.deleteSheet(leftover);
  }

  return { created: created, tables: Object.keys(SCHEMA).length };
}
