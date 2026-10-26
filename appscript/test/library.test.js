import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

function setup() {
  const rt = createRuntime({ config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 's' } })
  rt.load('Config.gs', 'Schema.gs', 'Db.gs', 'ChecklistLibrary.gs', 'Library.gs')
  rt.sandbox.ensureSchema()
  const tenant = rt.sandbox.dbInsert('Tenants', { name: 'Acme', slug: 'acme', active: 1 })
  return { rt, s: rt.sandbox, tenant }
}

test('the library installs all 303 items from the source checklist', () => {
  const { s, tenant } = setup()
  const result = s.installLibrary(tenant.id)

  assert.equal(result.sections, 16)
  assert.equal(result.items, 303)
  assert.equal(s.dbAll('LibraryItems').length, 303)
})

test('installing again changes nothing', () => {
  const { s, tenant } = setup()
  s.installLibrary(tenant.id)
  const second = s.installLibrary(tenant.id)

  assert.deepEqual({ ...second }, { sections: 0, groups: 0, items: 0 })
  assert.equal(s.dbAll('LibraryItems').length, 303, 'no duplicates')
})

test('item codes are the permanent identities the source document defines', () => {
  const { s, tenant } = setup()
  s.installLibrary(tenant.id)

  const first = s.dbFirst('LibraryItems', (r) => r.code === 'S01.G01.I01')
  assert.equal(first.text, 'Required PPE is clearly identified for the work area.')

  const codes = s.dbAll('LibraryItems').map((r) => r.code)
  assert.equal(new Set(codes).size, 303, 'every code is unique')
})

test('sections know whether they apply everywhere or to one department', () => {
  const { s, tenant } = setup()
  s.installLibrary(tenant.id)

  const general = s.dbFirst('LibrarySections', (r) => r.code === 'S01')
  const kitchen = s.dbFirst('LibrarySections', (r) => r.code === 'S02')
  assert.equal(general.applies_to, 'all_departments')
  assert.equal(kitchen.applies_to, 'department')
})

test('getLibrary returns the nesting the editor renders', () => {
  const { s, tenant } = setup()
  s.installLibrary(tenant.id)
  const library = s.getLibrary(tenant.id)

  assert.equal(library.length, 16)
  const total = library.reduce((n, sec) => n + sec.groups.reduce((m, g) => m + g.items.length, 0), 0)
  assert.equal(total, 303)
  assert.equal(library[0].groups[0].title, 'Personal Protective Equipment')
})
