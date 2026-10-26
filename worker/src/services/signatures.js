import { now } from '../db.js'

/**
 * Signatures.
 *
 * An inspection is a record somebody puts their name to. The inspector signs
 * before it is submitted - that is what turns a list of observations into a
 * statement - and the department supervisor countersigns at sign-off.
 */

export const SIGNATURE_ROLES = ['inspector', 'supervisor']

// A drawn signature is a few kB. The cap is generous enough for a large canvas
// on a tablet and small enough that nobody can post a photograph through here
// to dodge the photo retention policy.
export const MAX_SIGNATURE_BYTES = 256 * 1024

/**
 * Check a submitted data URL really is a small PNG drawing.
 *
 * It is written straight into the report's HTML, so anything that is not an
 * image here becomes markup in an email client later.
 */
export function validateSignatureImage(image) {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''))
  if (!match) return 'The signature must be a PNG or JPEG data URL'

  const bytes = Math.ceil((match[2].length * 3) / 4)
  if (bytes > MAX_SIGNATURE_BYTES) return 'The signature image is too large'
  if (bytes < 100) return 'The signature is empty'
  return null
}

export const signaturesFor = (db, inspectionId) =>
  db.all('SELECT * FROM inspection_signatures WHERE inspection_id = @id ORDER BY role', {
    id: inspectionId,
  })

/** Record (or replace) one signature. */
export async function putSignature(db, inspectionId, { role, name, image, capturedBy }) {
  await db.run(
    `INSERT INTO inspection_signatures (inspection_id, role, signed_name, captured_by, image, signed_at)
     VALUES (@inspection_id, @role, @name, @by, @image, @at)
     ON CONFLICT(inspection_id, role) DO UPDATE SET
       signed_name = excluded.signed_name,
       captured_by = excluded.captured_by,
       image = excluded.image,
       signed_at = excluded.signed_at`,
    { inspection_id: inspectionId, role, name, by: capturedBy, image, at: now() }
  )
  return db.get('SELECT * FROM inspection_signatures WHERE inspection_id = @id AND role = @role', {
    id: inspectionId,
    role,
  })
}

export const hasSignature = async (db, inspectionId, role) =>
  Boolean(
    await db.get('SELECT 1 AS ok FROM inspection_signatures WHERE inspection_id = @id AND role = @role', {
      id: inspectionId,
      role,
    })
  )
