-- The monthly spreadsheet in Drive.
--
-- The sheet is a view of the database, never a second copy of it: every rebuild
-- replaces the file's contents from the inspections table, so the two cannot
-- drift and nothing is lost if somebody edits the sheet by hand - their edit is
-- simply overwritten the next night, which is the behaviour an auditor wants
-- from a generated record.
--
-- All that is stored here is where the file went. Keeping the id means a rebuild
-- updates the same file rather than littering Drive with a new one each night,
-- so a link to "this month's sheet" stays valid all month.

CREATE TABLE IF NOT EXISTS unit_month_exports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id       INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  -- YYYY-MM. Month boundaries are UTC, matching every other timestamp stored.
  period        TEXT NOT NULL,
  -- Empty until the first successful write; a failed build leaves the row alone.
  file_id       TEXT NOT NULL DEFAULT '',
  web_view_link TEXT NOT NULL DEFAULT '',
  row_count     INTEGER NOT NULL DEFAULT 0,
  built_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (unit_id, period)
);
CREATE INDEX IF NOT EXISTS idx_month_exports_built ON unit_month_exports(built_at);
