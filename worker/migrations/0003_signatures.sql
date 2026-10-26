-- Signatures on an inspection.
--
-- Stored here, in the database, rather than in Drive with the photos. Three
-- reasons, and they all point the same way:
--
--   * A signature is the record, not evidence attached to it. Photos are purged
--     after a fortnight; a signature must still be there years later when
--     somebody asks who signed off on this.
--   * It is tiny. A drawn signature is a few kilobytes of PNG, against a
--     few hundred for a photo.
--   * Compiling a report must not depend on a Drive round trip to prove who
--     signed it. If Drive is unreachable the report says a photo is missing;
--     it must never say the signature is missing.

CREATE TABLE IF NOT EXISTS inspection_signatures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  -- inspector:  signed by whoever carried out the inspection, before submitting
  -- supervisor: the department supervisor's countersignature, at sign-off
  role          TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
  -- Who the signature belongs to. For a supervisor this is often somebody with
  -- no account at all, so the name is typed rather than looked up.
  signed_name   TEXT NOT NULL,
  -- The user who was signed in when it was captured. For an inspector that is
  -- the signatory; for a supervisor it is whoever held the phone, which is not
  -- the same thing and is worth keeping separate.
  captured_by   INTEGER REFERENCES users(id),
  -- The drawing, as a PNG data URL.
  image         TEXT NOT NULL,
  signed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- One signature per role: re-signing replaces, it does not stack up.
  UNIQUE (inspection_id, role)
);
CREATE INDEX IF NOT EXISTS idx_signatures_inspection ON inspection_signatures(inspection_id);
