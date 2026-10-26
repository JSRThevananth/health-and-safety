import { createApp } from '../src/app.js'
import { createDb } from '../src/db.js'
import { hashPassword } from '../src/crypto.js'
import { installLibrary } from '../src/services/library.js'
import { createDraft, publishDraft } from '../src/services/formTemplates.js'
import { createTestD1, createTestR2 } from './d1.js'

/**
 * A running app, backed by a fresh in-memory database.
 *
 * Hono's app.request() goes through the same router, middleware and handlers a
 * real request does, so these are end-to-end tests of the Worker rather than unit
 * tests of its parts.
 */
export async function createHarness({ env = {}, withR2 = false } = {}) {
  const d1 = createTestD1()
  const r2 = withR2 ? createTestR2() : undefined

  const bindings = {
    DB: d1,
    ...(r2 ? { EVIDENCE: r2 } : {}),
    ENVIRONMENT: 'test',
    // Long enough to pass the production check, and obviously not a real secret.
    JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-0123456789',
    STORAGE_BACKEND: withR2 ? 'r2' : 'none',
    ...env,
  }

  const app = createApp()
  const db = createDb(d1)

  const call = async (path, { method = 'GET', body, token, form, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } }
    if (token) init.headers.authorization = `Bearer ${token}`
    if (form) {
      init.body = form
    } else if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await app.request(`http://test.local/api${path}`, init, bindings)
    const text = await response.text()
    let payload = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = text
      }
    }
    return { status: response.status, body: payload, headers: response.headers }
  }

  return { app, db, d1, r2, bindings, call }
}

/**
 * The fixture every test builds on: one tenant, two units, the full checklist
 * library, and a published v1 per unit.
 *
 * Two units rather than one so unit-scoping is testable - a bug that lets one
 * unit see another's data is invisible in a single-unit fixture.
 */
export async function seedFixture(db) {
  const { id: tenantId } = await db.insert(
    "INSERT INTO tenants (name, slug) VALUES ('Demo Catering Group', 'demo')"
  )

  const unitA = (
    await db.insert(
      `INSERT INTO units (tenant_id, name, code, location)
       VALUES (@t, 'Heathrow Catering Unit', 'LHR', 'London, UK')`,
      { t: tenantId }
    )
  ).id
  const unitB = (
    await db.insert(
      `INSERT INTO units (tenant_id, name, code, location)
       VALUES (@t, 'Dubai Catering Unit', 'DXB', 'Dubai, UAE')`,
      { t: tenantId }
    )
  ).id

  const addUser = async (username, role, password, units = []) => {
    const { id } = await db.insert(
      `INSERT INTO users (tenant_id, username, email, full_name, initials, role, password_hash,
                          must_change_password, password_changed_at)
       VALUES (@t, @username, @email, @full_name, @initials, @role, @hash, 0, '2026-01-01T00:00:00Z')`,
      {
        t: tenantId,
        username,
        email: `${username}@example.com`,
        full_name: username,
        initials: username.slice(0, 2).toUpperCase(),
        role,
        // 1,000 rounds, not the production 210,000: the fixture hashes several
        // passwords per test file and the cost is the whole point of the real one.
        hash: await hashPassword(password, 1000),
      }
    )
    for (const unitId of units) {
      await db.run('INSERT INTO user_units (user_id, unit_id) VALUES (@u, @unit)', { u: id, unit: unitId })
    }
    return id
  }

  const omni = await addUser('admin', 'admin', 'admin-password')
  const manager = await addUser('lhr.manager', 'inspector', 'manager-password', [unitA])
  const inspector = await addUser('lhr.inspector', 'inspector', 'inspector-password', [unitA])
  const other = await addUser('dxb.inspector', 'inspector', 'inspector-password', [unitB])

  // The manager was a unit_admin in the old role model. In the simplified model
  // they are an inspector with elevated permissions for sign-off and CAPA work.
  for (const perm of ['capa.assign', 'capa.close', 'inspection.sign', 'inspection.delete', 'recipient.manage']) {
    await db.run(
      'INSERT INTO user_permissions (user_id, permission, granted) VALUES (@u, @p, 1)',
      { u: manager, p: perm }
    )
  }

  await installLibrary(db, tenantId)
  for (const unitId of [unitA, unitB]) {
    const draft = await createDraft(db, unitId, tenantId, omni)
    await publishDraft(db, draft.id)
  }

  return { tenantId, unitA, unitB, omni, manager, inspector, other }
}

/** Sign in and return the bearer token. */
export async function signIn(call, username, password) {
  const res = await call('/auth/login', { method: 'POST', body: { username, password } })
  if (res.status !== 200) throw new Error(`Sign-in failed for ${username}: ${JSON.stringify(res.body)}`)
  return res.body.access_token
}

/**
 * A 1x1 PNG, as the signature pad's canvas would export it. Small, but over the
 * "is this empty" floor the server checks.
 */
export const SIGNATURE_IMAGE = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='.repeat(3)}`

/** Sign an inspection as its inspector, which submission now requires. */
export async function signInspection(call, token, inspectionId, name = 'Test Inspector') {
  const res = await call(`/inspections/${inspectionId}/signature`, {
    method: 'POST',
    token,
    body: { role: 'inspector', name, image: SIGNATURE_IMAGE },
  })
  if (res.status !== 201) throw new Error(`Signing failed: ${JSON.stringify(res.body)}`)
  return res.body
}
