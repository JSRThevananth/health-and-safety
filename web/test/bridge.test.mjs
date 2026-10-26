import test from 'node:test'
import assert from 'node:assert/strict'
import { toAction } from '../src/lib/appsScriptBridge.js'

/*
 * The bridge is the seam between the two builds. If a path maps to the wrong
 * action, that feature silently breaks only in Apps Script - which is exactly the
 * kind of divergence that would otherwise be found by a user, not by me.
 */

test('health and sign-in', () => {
  assert.deepEqual(toAction('/health', 'GET'), ['health', {}])
  assert.deepEqual(
    toAction('/auth/login', 'POST', { username: 'omni', password: 'x' }),
    ['login', { username: 'omni', password: 'x' }]
  )
  assert.deepEqual(toAction('/auth/me', 'GET'), ['me', {}])
})

test('changing a password', () => {
  const [action, payload] = toAction('/auth/change-password', 'POST', {
    current_password: 'a', new_password: 'b',
  })
  assert.equal(action, 'changePassword')
  assert.equal(payload.new_password, 'b')
})

test('units and the unit checklist', () => {
  assert.deepEqual(toAction('/units', 'GET'), ['listUnits', {}])
  assert.deepEqual(toAction('/units/7/template', 'GET'), ['getTemplate', { unit_id: 7 }])
})

test('the same path means different things by method', () => {
  // POST starts or resumes a draft; GET only looks for one. Getting this backwards
  // would silently create an inspection every time the page loaded.
  assert.equal(toAction('/inspections/draft', 'POST', { unit_id: 3 })[0], 'openInspection')
  assert.equal(toAction('/inspections/draft?unit_id=3', 'GET')[0], 'getInspectionDraft')
})

test('query parameters become part of the payload', () => {
  const [, payload] = toAction('/inspections/draft?unit_id=42', 'GET')
  assert.equal(payload.unit_id, '42')
})

test('inspection actions carry the id from the path', () => {
  assert.deepEqual(
    toAction('/inspections/12', 'PATCH', { items: [] }),
    ['saveInspection', { items: [], inspection_id: 12 }]
  )
  assert.deepEqual(toAction('/inspections/12', 'DELETE'), ['discardInspection', { inspection_id: 12 }])
  assert.deepEqual(toAction('/inspections/12', 'GET'), ['getInspection', { inspection_id: 12 }])
  assert.deepEqual(toAction('/inspections/12/submit', 'POST'), ['submitInspection', { inspection_id: 12 }])
  assert.deepEqual(toAction('/inspections/12/sign', 'POST'), ['signInspection', { inspection_id: 12 }])
})

test('an unmapped path fails loudly rather than silently doing nothing', () => {
  assert.throws(() => toAction('/something/new', 'GET'), /No Apps Script action/)
})

/*
 * Routes that exist only on Cloudflare.
 *
 * The Apps Script build is superseded (see the root README). It has no object
 * storage, no signed photo links and no per-unit recipient table, so the
 * features built on those cannot be bridged to it - and pretending otherwise by
 * adding a mapping that fails at runtime would be worse than saying so here.
 *
 * Anything NOT on this list must still be bridged, which is what stops the two
 * builds drifting apart by accident rather than by decision.
 */
const CLOUDFLARE_ONLY = [
  /^\/attachments/,
  /^\/photos\//,
  /^\/inspections\/\d+\/report/,
  /^\/inspections\/\d+\/recipients$/,
  /^\/inspections\/\d+\/signature/,
  /^\/units\/\d+\/recipients/,
  // The monthly sheet is written by the Worker's Drive client; the Apps Script
  // build has no equivalent and is not getting one.
  /^\/units\/\d+\/exports/,
  // Corrective actions were built after the move to Cloudflare and have no
  // Apps Script backend behind them.
  /^\/capas/,
  // The dashboard's figures are derived by the Worker from inspections and
  // corrective actions, neither of which the Apps Script build has.
  /^\/kpis/,
  // User administration and form editing were never in the Apps Script build;
  // the bridge is an inspection-only shim.
  /^\/users/,
  /^\/units\/\d+\/template\/(draft|library|versions)/,
  /^\/setup/,
]

test('every path the app actually calls is mapped', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const url = await import('node:url')

  const src = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'src')
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.jsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(src)

  // Collect the literal paths passed to api(...) across the whole frontend.
  const paths = new Set()
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8')
    for (const m of code.matchAll(/\bapi\(\s*[`'"]([^`'"]+)[`'"]/g)) paths.add(m[1])
    for (const m of code.matchAll(/\bapi\(\s*`([^`]+)`/g)) paths.add(m[1])
  }

  assert.ok(paths.size > 0, 'expected to find api() calls to check')

  for (const raw of paths) {
    // Template literals leave ${...} behind; substitute a number to test the shape.
    const concrete = raw.replace(/\$\{[^}]+\}/g, '1').replace(/\?.*$/, '')
    if (CLOUDFLARE_ONLY.some((pattern) => pattern.test(concrete))) continue

    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      try {
        toAction(concrete, method)
      } catch (error) {
        assert.fail(`${method} ${concrete} (from api('${raw}')) has no Apps Script action`)
      }
    }
  }
})

test('a validation failure shows what went wrong, not just that it did', async () => {
  const { ApiError } = await import('../src/lib/api.js')

  const detailed = new ApiError(422, {
    error: 'Validation failed',
    issues: [{ path: 'new_password', message: 'Use at least 6 characters' }],
  })
  assert.equal(detailed.message, 'Use at least 6 characters')

  // Several issues are all surfaced, not just the first.
  const several = new ApiError(422, {
    error: 'Validation failed',
    issues: [
      { path: 'email', message: 'Invalid email' },
      { path: 'unit_code', message: 'Letters, digits, - and _ only' },
    ],
  })
  assert.equal(several.message, 'Invalid email. Letters, digits, - and _ only')

  // And an error with no issue list still reads sensibly.
  assert.equal(new ApiError(409, { error: 'Already set up' }).message, 'Already set up')
  assert.equal(new ApiError(500, null).message, 'Request failed (500)')
})
