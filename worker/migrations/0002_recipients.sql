-- Per-unit report recipients.
--
-- The rule this table exists to enforce: one unit's report must never reach
-- another unit's recipients. Recipients therefore hang off the unit, not the
-- tenant, and every query that reads them is scoped by unit_id.
--
-- Recipients are plain addresses, not user accounts. Most of the people who
-- should receive a report - a station manager, a client's quality lead, an
-- external auditor - will never sign in to the app.

CREATE TABLE IF NOT EXISTS unit_recipients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id    INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  -- Which reports this address gets. 'inspection' is the per-inspection report;
  -- 'monthly' is the summary. A person can be on one list without the other.
  report_type TEXT NOT NULL DEFAULT 'inspection'
              CHECK (report_type IN ('inspection', 'monthly')),
  -- Pre-ticked in the send dialog. An inspector can still deselect, and can tick
  -- someone who is not a default, so the list is a starting point not a cage.
  default_selected INTEGER NOT NULL DEFAULT 1,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- One address per report type per unit. Without this a double-click on "add"
  -- quietly sends every future report to someone twice.
  UNIQUE (unit_id, email, report_type)
);
CREATE INDEX IF NOT EXISTS idx_recipients_unit ON unit_recipients(unit_id, report_type);

-- Which report an email_log row belongs to, so "was the report for this
-- inspection sent, and to whom" is answerable from the record rather than by
-- reading subject lines.
ALTER TABLE email_log ADD COLUMN entity_type TEXT NOT NULL DEFAULT '';
ALTER TABLE email_log ADD COLUMN entity_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_email_log_entity ON email_log(entity_type, entity_id);
