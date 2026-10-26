import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

const FILES = [
  'Config.gs', 'Schema.gs', 'Db.gs', 'Crypto.gs', 'Permissions.gs', 'Auth.gs',
  'ChecklistLibrary.gs', 'Library.gs', 'Templates.gs', 'Inspections.gs',
  'Mailer.gs', 'Storage.gs', 'Api.gs',
]

function setup() {
  const rt = createRuntime({
    config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 'a-secret-long-enough-for-tests', DRIVE_FOLDER_ID: 'folder-1' },
  })
  rt.load(...FILES)
  const s = rt.sandbox
  s.ensureSchema()

  const tenant = s.dbInsert('Tenants', { name: 'Acme', slug: 'acme', active: 1 })
  const unitA = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Heathrow', code: 'LHR', active: 1 })
  const unitB = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Dubai', code: 'DXB', active: 1 })

  const make = (username, role, password, units, mustChange) => {
    const salt = s.generateSalt()
    const u = s.dbInsert('Users', {
      tenant_id: tenant.id, username, email: username + '@example.com', full_name: username,
      role, password_salt: salt, password_hash: s.hashPassword(password, salt),
      must_change_password: mustChange ? 1 : 0, active: 1,
    })
    ;(units || []).forEach((id) => s.dbInsert('UserUnits', { user_id: u.id, unit_id: id }))
    return u
  }

  make('omni', 'omni_admin', 'omni-pass-1234', [], false)
  make('manager', 'unit_admin', 'manager-pass-1234', [unitA.id], false)
  make('inspector', 'inspector', 'inspector-pass-1234', [unitA.id], false)
  make('newbie', 'inspector', 'temp-issued-1234', [unitA.id], true)

  s.installLibrary(tenant.id)
  const mgr = s.dbFirst('Users', (u) => u.username === 'manager')
  s.publishDraft(s.createDraft(unitA.id, tenant.id, mgr.id).id)
  s.publishDraft(s.createDraft(unitB.id, tenant.id, mgr.id).id)

  const tokenFor = (username, password) => s.api('login', { username, password }).data.token

  return { rt, s, tenant, unitA, unitB, tokenFor, api: s.api }
}

test('health is reachable without signing in', () => {
  const { api } = setup()
  const res = api('health', {})
  assert.equal(res.ok, true)
  assert.equal(res.data.status, 'ok')
  assert.equal(res.data.email, 'dry-run')
})

test('errors come back as data, not as thrown exceptions', () => {
  const { api } = setup()
  const res = api('login', { username: 'omni', password: 'wrong' })
  assert.equal(res.ok, false)
  assert.equal(res.error, 'Invalid credentials')
})

test('an unknown action is refused', () => {
  const { api, tokenFor } = setup()
  const token = tokenFor('omni', 'omni-pass-1234')
  const res = api('deleteEverything', { token })
  assert.equal(res.ok, false)
  assert.match(res.error, /Unknown action/)
})

test('protected actions require a token', () => {
  const { api } = setup()
  assert.equal(api('listUnits', {}).ok, false)
  assert.equal(api('listUnits', { token: 'forged.token' }).ok, false)
})

test('an omni admin sees every unit, a unit admin sees only theirs', () => {
  const { api, tokenFor, unitA } = setup()
  const all = api('listUnits', { token: tokenFor('omni', 'omni-pass-1234') })
  assert.equal(all.data.length, 2)

  const scoped = api('listUnits', { token: tokenFor('manager', 'manager-pass-1234') })
  assert.equal(scoped.data.length, 1)
  assert.equal(scoped.data[0].id, unitA.id)
})

test('a unit admin cannot read another unit checklist', () => {
  const { api, tokenFor, unitB } = setup()
  const res = api('getTemplate', { token: tokenFor('manager', 'manager-pass-1234'), unit_id: unitB.id })
  assert.equal(res.ok, false)
  assert.match(res.error, /No access to this unit/)
})

test('a temporary password blocks every action but the change itself', () => {
  const { api, tokenFor, unitA } = setup()
  const token = tokenFor('newbie', 'temp-issued-1234')

  const blocked = api('listUnits', { token })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'PASSWORD_CHANGE_REQUIRED')

  // The client still needs to know who it is to render the change screen.
  assert.equal(api('me', { token }).ok, true)

  const changed = api('changePassword', {
    token, current_password: 'temp-issued-1234', new_password: 'chosen-by-me-99',
  })
  assert.equal(changed.ok, true)
  assert.equal(changed.data.must_change_password, false)
  assert.equal(api('listUnits', { token }).ok, true, 'same session, now unblocked')
})

test('an inspection saves, resumes and reports its counts', () => {
  const { api, tokenFor, unitA } = setup()
  const token = tokenFor('inspector', 'inspector-pass-1234')

  const opened = api('openInspection', { token, unit_id: unitA.id })
  assert.equal(opened.ok, true)
  assert.equal(opened.data.summary_counts.total, 303)

  const items = opened.data.sections[0].items
  const saved = api('saveInspection', {
    token, inspection_id: opened.data.id, department: 'Hot Kitchen',
    items: [{ template_item_id: items[0].id, rating: 'critical', note: 'Fryer guard missing' }],
  })
  assert.equal(saved.data.summary_counts.critical, 1)

  const resumed = api('getInspectionDraft', { token, unit_id: unitA.id })
  assert.equal(resumed.data.id, opened.data.id)
  assert.equal(resumed.data.department, 'Hot Kitchen')
})

test('an inspector cannot touch another inspector draft', () => {
  const { api, tokenFor, unitA, s } = setup()
  const inspectorToken = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token: inspectorToken, unit_id: unitA.id })

  const managerToken = tokenFor('manager', 'manager-pass-1234')
  const res = api('saveInspection', {
    token: managerToken, inspection_id: opened.data.id, items: [],
  })
  assert.equal(res.ok, false)
  assert.match(res.error, /belongs to another inspector/)
})

test('submitting sends the report to that unit recipients only', () => {
  const { api, tokenFor, unitA, unitB, s, rt } = setup()
  // Give each unit its own list, which is the whole point of per-unit recipients.
  s.dbInsert('Recipients', { unit_id: unitA.id, email: 'lhr-manager@example.com', active: 1, report_types: '' })
  s.dbInsert('Recipients', { unit_id: unitB.id, email: 'dxb-manager@example.com', active: 1, report_types: '' })
  s.dbResetCache()

  const token = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token, unit_id: unitA.id })
  const items = opened.data.sections[0].items
  api('saveInspection', {
    token, inspection_id: opened.data.id,
    items: [{ template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' }],
  })

  const submitted = api('submitInspection', { token, inspection_id: opened.data.id })
  assert.equal(submitted.ok, true)
  assert.equal(submitted.data.status, 'submitted')

  const logged = s.dbAll('EmailLog').filter((r) => r.template === 'inspection_report')
  assert.equal(logged.length, 1)
  assert.equal(logged[0].recipients, 'lhr-manager@example.com')
  assert.equal(
    logged[0].recipients.includes('dxb'), false,
    'one unit report must never reach another unit list'
  )
})

test('an inspector cannot sign off, a unit admin can', () => {
  const { api, tokenFor, unitA, s } = setup()
  const token = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token, unit_id: unitA.id })
  const items = opened.data.sections[0].items
  api('saveInspection', {
    token, inspection_id: opened.data.id,
    items: [{ template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' }],
  })
  api('submitInspection', { token, inspection_id: opened.data.id })

  const bySelf = api('signInspection', { token, inspection_id: opened.data.id })
  assert.equal(bySelf.ok, false, 'an inspector has no inspection.sign permission')

  const byManager = api('signInspection', {
    token: tokenFor('manager', 'manager-pass-1234'), inspection_id: opened.data.id,
  })
  assert.equal(byManager.ok, true)
  assert.equal(byManager.data.status, 'signed')
})

test('a submitted inspection can no longer be edited', () => {
  const { api, tokenFor, unitA } = setup()
  const token = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token, unit_id: unitA.id })
  const items = opened.data.sections[0].items
  api('saveInspection', {
    token, inspection_id: opened.data.id,
    items: [{ template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' }],
  })
  api('submitInspection', { token, inspection_id: opened.data.id })

  const res = api('saveInspection', { token, inspection_id: opened.data.id, items: [] })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'INSPECTION_LOCKED')
})

test('an out-of-scope inspection is indistinguishable from a missing one', () => {
  const { api, tokenFor, unitB } = setup()
  const omniToken = tokenFor('omni', 'omni-pass-1234')
  const other = api('openInspection', { token: omniToken, unit_id: unitB.id })

  const managerToken = tokenFor('manager', 'manager-pass-1234')
  const outOfScope = api('getInspection', { token: managerToken, inspection_id: other.data.id })
  const missing = api('getInspection', { token: managerToken, inspection_id: 999999 })

  assert.equal(outOfScope.error, missing.error, 'must not reveal that it exists')
})

test('a photo is stored in Drive and recorded', () => {
  const { api, tokenFor, unitA, rt } = setup()
  const token = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token, unit_id: unitA.id })
  const item = opened.data.sections[0].items[0]

  const res = api('uploadAttachment', {
    token, inspection_id: opened.data.id, template_item_id: item.id,
    filename: 'evidence.jpg',
    data: 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64'),
  })

  assert.equal(res.ok, true)
  assert.equal(res.data.mime_type, 'image/jpeg')
  assert.equal(rt.driveFiles.length, 1, 'the file really reached Drive')
})

test('an executable disguised as evidence is refused', () => {
  const { api, tokenFor, unitA, rt } = setup()
  const token = tokenFor('inspector', 'inspector-pass-1234')
  const opened = api('openInspection', { token, unit_id: unitA.id })
  const item = opened.data.sections[0].items[0]

  const res = api('uploadAttachment', {
    token, inspection_id: opened.data.id, template_item_id: item.id,
    filename: 'evil.sh',
    data: 'data:application/x-sh;base64,' + Buffer.from('rm -rf /').toString('base64'),
  })

  assert.equal(res.ok, false)
  assert.match(res.error, /Unsupported file type/)
  assert.equal(rt.driveFiles.length, 0, 'nothing reached Drive')
})

test('recipients are managed per unit and scoped', () => {
  const { api, tokenFor, unitA, unitB } = setup()
  const managerToken = tokenFor('manager', 'manager-pass-1234')

  const added = api('addRecipient', {
    token: managerToken, unit_id: unitA.id, email: 'safety@example.com', name: 'Safety Lead',
  })
  assert.equal(added.ok, true)

  const bad = api('addRecipient', { token: managerToken, unit_id: unitA.id, email: 'not-an-email' })
  assert.equal(bad.ok, false)

  const foreign = api('addRecipient', {
    token: managerToken, unit_id: unitB.id, email: 'someone@example.com',
  })
  assert.equal(foreign.ok, false, 'cannot add a recipient to another unit')
})
