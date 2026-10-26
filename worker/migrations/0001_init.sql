-- Initial schema for Cloudflare D1.
--
-- Carried across from the Node build's schema.sql unchanged apart from the two
-- PRAGMA lines: D1 sets the journal mode itself and enforces foreign keys on every
-- database, so a PRAGMA statement here is rejected rather than ignored.

--
-- One timestamp format, everywhere. SQLite's datetime('now') writes
-- "2026-10-09 23:21:47" while the application writes "2026-10-09T23:21:47Z",
-- and the two do not sort against each other: a space sorts before "T", so a row
-- written by a column default would compare as older than one written by the app
-- on the same day. Retention windows and "most recent first" both depend on that
-- comparison, so the defaults are spelled out to match the application's format.

-- Identity, tenancy and access control.
-- Domain tables (inspections, templates, CAPAs) are added in the next phase.

-- A customer organisation (a catering company). Everything else hangs off a tenant so
-- that going commercial does not require reworking every table and query.
CREATE TABLE IF NOT EXISTS tenants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  -- Retention windows, configurable per customer.
  -- Notes are archived (hidden from normal views) rather than deleted; ratings and
  -- CAPA history are kept indefinitely so recurrence detection keeps working.
  note_retention_days  INTEGER NOT NULL DEFAULT 30,
  photo_retention_days INTEGER NOT NULL DEFAULT 14,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- A physical catering unit / station. Report recipients and form customisation are
-- per unit, so one unit's report never reaches another unit's recipients.
CREATE TABLE IF NOT EXISTS units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT '',
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  -- Unique per tenant, not globally: two customers may each have an "admin".
  -- Frontline staff often have no company email, so username login must stay possible.
  username      TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  full_name     TEXT NOT NULL DEFAULT '',
  initials      TEXT NOT NULL DEFAULT '',
  -- admin sees every unit in the tenant; all other roles are scoped to assigned units.
  -- omni_admin spans every unit in the tenant; all other roles are scoped to the
  -- units assigned in user_units.
  role          TEXT NOT NULL DEFAULT 'inspector'
                CHECK (role IN ('omni_admin', 'unit_admin', 'inspector', 'viewer')),
  password_hash TEXT NOT NULL,
  -- Set when an admin creates the account or resets the password. Until the user
  -- chooses their own password the API refuses every route but the change itself,
  -- so an admin-chosen temporary password can never become a working credential.
  must_change_password INTEGER NOT NULL DEFAULT 1,
  password_changed_at  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- Which units a non-admin user may see. Admins are deliberately absent from this table.
CREATE TABLE IF NOT EXISTS user_units (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, unit_id)
);

-- Per-user grants layered on top of the role preset, so an admin can hand a limited
-- user one extra capability (or take one away) without inventing a new role.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted    INTEGER NOT NULL CHECK (granted IN (0, 1)),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  -- r2 is Cloudflare's object store; gdrive keeps evidence in the customer's own
  -- Drive. 'local' survives only so a record written by the Node build still loads.
  storage       TEXT NOT NULL CHECK (storage IN ('r2', 'gdrive', 'local')),
  storage_ref   TEXT NOT NULL,
  web_view_link TEXT NOT NULL DEFAULT '',
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- Set when the blob is purged by retention policy. The row is kept as a tombstone so
  -- an auditor sees "purged on <date> under <policy>" rather than a broken image.
  purged_at     TEXT,
  purge_policy  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  template   TEXT NOT NULL,
  recipients TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Checklist library: the master set of items, shared across every unit.
-- Item codes (e.g. S02.G01.I07) are permanent identities. A unit may reword an
-- item, but it keeps its library id, which is what makes cross-unit comparison
-- and repeat-finding detection possible.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS library_sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  code       TEXT NOT NULL,
  title      TEXT NOT NULL,
  -- 'all_departments' sections apply everywhere; 'department' ones are area-specific.
  applies_to TEXT NOT NULL DEFAULT 'department'
             CHECK (applies_to IN ('all_departments', 'department')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS library_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES library_sections(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (section_id, code)
);

CREATE TABLE IF NOT EXISTS library_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES library_groups(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  text        TEXT NOT NULL,
  -- Weighting for the unit risk score. Defaults to 1; H&S staff tune the items that
  -- carry disproportionate risk (e.g. aircraft exclusion zones vs. lighting).
  risk_weight REAL NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (group_id, code)
);

-- A unit's own items, kept outside template versions so a custom item keeps one
-- identity across every version of that unit's form.
CREATE TABLE IF NOT EXISTS unit_custom_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id     INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  section_id  INTEGER NOT NULL REFERENCES library_sections(id),
  group_id    INTEGER REFERENCES library_groups(id),
  text        TEXT NOT NULL,
  risk_weight REAL NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_items_unit ON unit_custom_items(unit_id);

-- One version of a unit's checklist. Published versions are immutable: an inspection
-- pins the version it was filled against, so history always renders as it was signed.
CREATE TABLE IF NOT EXISTS unit_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published', 'archived')),
  notes        TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  published_at TEXT,
  UNIQUE (unit_id, version)
);
CREATE INDEX IF NOT EXISTS idx_templates_unit_status ON unit_templates(unit_id, status);

CREATE TABLE IF NOT EXISTS unit_template_sections (
  template_id INTEGER NOT NULL REFERENCES unit_templates(id) ON DELETE CASCADE,
  section_id  INTEGER NOT NULL REFERENCES library_sections(id),
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, section_id)
);

CREATE TABLE IF NOT EXISTS unit_template_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER NOT NULL REFERENCES unit_templates(id) ON DELETE CASCADE,
  -- Exactly one of these is set: a library item, or one of the unit's own.
  library_item_id INTEGER REFERENCES library_items(id),
  custom_item_id  INTEGER REFERENCES unit_custom_items(id),
  -- The unit's reworded text. NULL means "use the library wording".
  text_override   TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  risk_weight     REAL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  CHECK ((library_item_id IS NULL) <> (custom_item_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_template_items ON unit_template_items(template_id);

-- ---------------------------------------------------------------------------
-- Inspections
--
-- An inspection pins the template version it was filled against, so a record
-- always renders exactly as it was completed even after the unit edits its form.
--
-- Only items the inspector actually touched are stored. Everything else is
-- satisfactory by definition - that is the exception-based model the form uses,
-- and it means an untouched 303-point inspection costs zero item rows instead of
-- 303. The full record stays reconstructable because the pinned template version
-- is immutable, and it gives the "accepted at default" count for free.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inspections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id      INTEGER NOT NULL REFERENCES units(id),
  template_id  INTEGER NOT NULL REFERENCES unit_templates(id),
  inspector_id INTEGER NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'submitted', 'signed')),
  department   TEXT NOT NULL DEFAULT '',
  shift        TEXT NOT NULL DEFAULT '',
  summary      TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  submitted_at TEXT,
  signed_at    TEXT,
  signed_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_inspections_unit ON inspections(unit_id, status);

-- One open draft per inspector per unit. Starting a fresh inspection means
-- discarding the current draft, which is what the "reset" action does.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspections_one_draft
  ON inspections(unit_id, inspector_id) WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS inspection_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id    INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  template_item_id INTEGER NOT NULL REFERENCES unit_template_items(id),
  rating           TEXT NOT NULL
                   CHECK (rating IN ('satisfactory', 'needs_improvement', 'critical', 'na')),
  note             TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (inspection_id, template_item_id)
);
CREATE INDEX IF NOT EXISTS idx_inspection_items ON inspection_items(inspection_id);

-- ---------------------------------------------------------------------------
-- Sign-in throttling.
--
-- The Node build counted failed sign-ins in memory, which works for one process
-- and fails for a Worker: every request may land in a different data centre, so
-- an in-memory counter would let an attacker get 10 guesses per colo. Counting in
-- the database makes the limit mean one thing globally.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Both are recorded: the username catches a spray against one account from many
  -- addresses, the IP catches one address working through a list of usernames.
  username   TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);
