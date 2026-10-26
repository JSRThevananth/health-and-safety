-- Corrective actions.
--
-- An inspection records that a fire door was wedged open. Without this table
-- nothing records that somebody closed it, who, and when - which is the first
-- thing an auditor asks for after the finding itself.
--
-- Deliberately raise -> assign -> close, and no further. A workflow with
-- containment, root cause, effectiveness checks and sign-off gates is what the
-- standards describe, and it is also what people stop filling in by the second
-- week. The shape below is small enough to be used on a phone next to the thing
-- that is wrong, which is the only version that produces real data.

CREATE TABLE IF NOT EXISTS capas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id       INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,

  -- Where it came from. Nullable on purpose: most actions are raised off a
  -- finding, but a hazard noticed on the way to the office is still an action,
  -- and making it wait for an inspection is how it gets forgotten.
  inspection_id      INTEGER REFERENCES inspections(id),
  template_item_id   INTEGER REFERENCES unit_template_items(id),

  title         TEXT NOT NULL,
  detail        TEXT NOT NULL DEFAULT '',
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),

  -- open: outstanding. done: fixed, with a closing note. cancelled: raised in
  -- error or no longer applicable - kept rather than deleted, because "this was
  -- raised and dropped" is itself a thing an audit asks about.
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),

  owner_id      INTEGER REFERENCES users(id),
  due_date      TEXT,

  raised_by     INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  closed_at     TEXT,
  closed_by     INTEGER REFERENCES users(id),
  closing_note  TEXT NOT NULL DEFAULT ''
);

-- The three questions actually asked of this table: what is open in my unit,
-- what is on my plate, and what is overdue.
CREATE INDEX IF NOT EXISTS idx_capas_unit_status ON capas(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_capas_owner_status ON capas(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_capas_due ON capas(status, due_date);

-- Append-only history.
--
-- The capas row says where an action stands; this says how it got there. An
-- auditor's question is rarely "is it closed" - it is "when was it raised, how
-- long did it sit unassigned, and who signed it off", and none of that can be
-- reconstructed from a row that is updated in place.
CREATE TABLE IF NOT EXISTS capa_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  capa_id  INTEGER NOT NULL REFERENCES capas(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('raised', 'assigned', 'updated', 'closed', 'reopened', 'cancelled', 'note')),
  detail   TEXT NOT NULL DEFAULT '',
  actor_id INTEGER REFERENCES users(id),
  at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_capa_events ON capa_events(capa_id, at);
