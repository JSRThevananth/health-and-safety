import bcrypt from 'bcryptjs'
import { getDb } from './index.js'
import { installLibrary } from '../services/library.js'
import { createDraft, publishDraft } from '../services/formTemplates.js'

const TENANT = {
  name: process.env.SEED_TENANT_NAME || 'Demo Catering Group',
  slug: process.env.SEED_TENANT_SLUG || 'demo',
}

const ADMIN = {
  username: process.env.SEED_ADMIN_USERNAME || 'omni',
  email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  full_name: process.env.SEED_ADMIN_NAME || 'Omni Administrator',
  password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
}

const db = getDb()
const tenantIdOf = () => db.prepare('SELECT id FROM tenants WHERE slug = ?').get(TENANT.slug).id

if (db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n > 0) {
  console.log('Already seeded - nothing to do.')
} else {
  const seed = db.transaction(() => {
    const tenantId = Number(
      db.prepare('INSERT INTO tenants (name, slug) VALUES (?, ?)').run(TENANT.name, TENANT.slug)
        .lastInsertRowid
    )

    // Two units so unit-scoping is demonstrable straight after seeding.
    const insertUnit = db.prepare(
      'INSERT INTO units (tenant_id, name, code, location) VALUES (?, ?, ?, ?)'
    )
    const unitA = Number(insertUnit.run(tenantId, 'Heathrow Catering Unit', 'LHR', 'London, UK').lastInsertRowid)
    const unitB = Number(insertUnit.run(tenantId, 'Dubai Catering Unit', 'DXB', 'Dubai, UAE').lastInsertRowid)

    const insertUser = db.prepare(
      `INSERT INTO users (tenant_id, username, email, full_name, initials, role, password_hash,
                          must_change_password, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`
    )
    const adminId = Number(
      insertUser.run(
        tenantId, ADMIN.username, ADMIN.email, ADMIN.full_name, 'OA', 'omni_admin',
        bcrypt.hashSync(ADMIN.password, 10)
      ).lastInsertRowid
    )

    const managerId = Number(
      insertUser.run(
        tenantId, 'lhr.manager', 'lhr.manager@example.com', 'LHR H&S Manager', 'LHM',
        'unit_admin', bcrypt.hashSync('manager123', 10)
      ).lastInsertRowid
    )
    const inspectorId = Number(
      insertUser.run(
        tenantId, 'lhr.inspector', 'lhr.inspector@example.com', 'LHR Inspector', 'LHI',
        'inspector', bcrypt.hashSync('inspector123', 10)
      ).lastInsertRowid
    )

    const link = db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)')
    link.run(managerId, unitA)
    link.run(inspectorId, unitA)

    return { adminId, unitA, unitB }
  })

  const { adminId, unitA, unitB } = seed()

  // Install the master checklist and give each unit a published v1 to inspect against.
  const installed = installLibrary(tenantIdOf())
  for (const unitId of [unitA, unitB]) {
    publishDraft(createDraft(unitId, tenantIdOf(), adminId).id)
  }

  console.log(`Seeded tenant "${TENANT.name}" with 2 units.`)
  console.log(
    `  Checklist library: ${installed.sections} sections, ${installed.items} items (published as v1 per unit).`
  )
  console.log('  Logins:')
  console.log(`    ${ADMIN.username} / ${ADMIN.password}   (omni_admin - every unit)`)
  console.log('    lhr.manager / manager123     (unit_admin - Heathrow only)')
  console.log('    lhr.inspector / inspector123 (inspector - Heathrow only)')
  console.log('  Change these before any real deployment.')
}
