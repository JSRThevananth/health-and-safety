import bcrypt from 'bcryptjs'
import { installLibrary } from '../src/services/library.js'

/** Create a tenant with two units and one user per role. Mirrors the seed layout. */
export function seedTenant(db, { slug = 'acme' } = {}) {
  const tenantId = Number(
    db.prepare('INSERT INTO tenants (name, slug) VALUES (?, ?)').run('Acme Catering', slug)
      .lastInsertRowid
  )
  const insertUnit = db.prepare('INSERT INTO units (tenant_id, name, code) VALUES (?, ?, ?)')
  const unitA = Number(insertUnit.run(tenantId, 'Heathrow', 'LHR').lastInsertRowid)
  const unitB = Number(insertUnit.run(tenantId, 'Dubai', 'DXB').lastInsertRowid)

  // must_change_password = 0: these fixtures represent established accounts. The
  // forced-change flow has its own suite.
  const insertUser = db.prepare(
    `INSERT INTO users (tenant_id, username, email, full_name, role, password_hash,
                        must_change_password, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
  )
  const make = (username, role) =>
    Number(
      insertUser.run(
        tenantId, username, `${username}@example.com`, username, role,
        // Low cost factor: these are throwaway fixtures, not stored credentials.
        bcrypt.hashSync('password123', 4)
      ).lastInsertRowid
    )

  const admin = make('admin', 'omni_admin')
  const manager = make('manager', 'unit_admin')
  const inspector = make('inspector', 'inspector')
  const viewer = make('viewer', 'viewer')

  const link = db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)')
  link.run(manager, unitA)
  link.run(inspector, unitA)
  link.run(viewer, unitA)

  installLibrary(tenantId)
  return { tenantId, unitA, unitB, admin, manager, inspector, viewer }
}
