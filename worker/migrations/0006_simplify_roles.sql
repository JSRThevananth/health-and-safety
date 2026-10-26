-- Rename omni_admin and unit_admin to admin; drop multi-unit role support.
UPDATE users SET role = 'admin' WHERE role IN ('omni_admin', 'unit_admin');

-- SQLite cannot ALTER CHECK constraints, so recreate the table.
CREATE TABLE users_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  username        TEXT NOT NULL,
  email           TEXT NOT NULL DEFAULT '',
  full_name       TEXT NOT NULL DEFAULT '',
  initials        TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT 'inspector'
                  CHECK (role IN ('admin', 'inspector', 'viewer')),
  password_hash   TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  password_changed_at  TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, username)
);

INSERT INTO users_new (id, tenant_id, username, email, full_name, initials, role,
                       password_hash, must_change_password, password_changed_at,
                       active, created_at, updated_at)
SELECT id, tenant_id, username, email, full_name, initials, role,
       password_hash, must_change_password, password_changed_at,
       active, created_at, created_at
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
