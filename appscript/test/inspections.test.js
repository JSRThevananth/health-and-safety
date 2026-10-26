import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from './harness.js'

function setup() {
  const rt = createRuntime({ config: { SPREADSHEET_ID: 'x', TOKEN_SECRET: 's' } })
  rt.load('Config.gs', 'Schema.gs', 'Db.gs', 'Crypto.gs', 'Permissions.gs',
          'ChecklistLibrary.gs', 'Library.gs', 'Templates.gs', 'Inspections.gs')
  const s = rt.sandbox
  s.ensureSchema()

  const tenant = s.dbInsert('Tenants', { name: 'Acme', slug: 'acme', active: 1 })
  const unitA = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Heathrow', code: 'LHR', active: 1 })
  const unitB = s.dbInsert('Units', { tenant_id: tenant.id, name: 'Dubai', code: 'DXB', active: 1 })
  const inspector = s.dbInsert('Users', {
    tenant_id: tenant.id, username: 'insp', full_name: 'Inspector', role: 'inspector', active: 1,
  })
  const manager = s.dbInsert('Users', {
    tenant_id: tenant.id, username: 'mgr', full_name: 'Manager', role: 'unit_admin', active: 1,
  })

  s.installLibrary(tenant.id)
  s.publishDraft(s.createDraft(unitA.id, tenant.id, manager.id).id)

  return { rt, s, tenant, unitA, unitB, inspector, manager }
}

const flat = (insp) => insp.sections.reduce((acc, sec) => acc.concat(sec.items), [])

test('a first draft seeds the whole library with everything enabled', () => {
  const { s, unitA } = setup()
  const template = s.resolveTemplate(s.getPublishedTemplate(unitA.id).id)

  assert.equal(template.version, 1)
  assert.equal(template.stats.items_total, 303)
  assert.equal(template.stats.items_effective, 303)
})

test('starting an inspection defaults every item to satisfactory', () => {
  const { s, unitA, inspector } = setup()
  const { inspection, created } = s.openDraft(unitA.id, inspector.id)
  assert.equal(created, true)

  const resolved = s.resolveInspection(inspection.id)
  assert.equal(resolved.summary_counts.total, 303)
  assert.equal(resolved.summary_counts.satisfactory, 303)
  assert.equal(resolved.summary_counts.touched, 0)
  assert.equal(resolved.summary_counts.untouched, 303)
})

test('a partial inspection is stored and resumes exactly', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))

  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[1].id, rating: 'critical', note: 'Fryer guard missing' },
    { template_item_id: items[5].id, rating: 'needs_improvement', note: 'Boots worn' },
  ])

  // Fresh read, as if the app were reopened later.
  s.dbResetCache()
  const resumed = s.resolveInspection(inspection.id)
  assert.equal(resumed.summary_counts.critical, 1)
  assert.equal(resumed.summary_counts.exceptions, 2)
  assert.equal(resumed.summary_counts.touched, 2)

  const restored = flat(resumed).find((i) => i.id === items[1].id)
  assert.equal(restored.rating, 'critical')
  assert.equal(restored.note, 'Fryer guard missing')
})

test('only touched items occupy rows', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))

  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'x' },
  ])
  assert.equal(s.dbAll('InspectionItems').length, 1, '303 items, one row')
})

test('undoing a rating returns the item to untouched', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))

  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'wrong row' },
  ])
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'satisfactory', note: '' },
  ])

  s.dbResetCache()
  const after = s.resolveInspection(inspection.id)
  assert.equal(after.summary_counts.touched, 0, 'not recorded as an explicit pass')
  assert.equal(s.dbAll('InspectionItems').length, 0)
})

test('resuming returns the same draft rather than starting another', () => {
  const { s, unitA, inspector } = setup()
  const first = s.openDraft(unitA.id, inspector.id)
  const second = s.openDraft(unitA.id, inspector.id)

  assert.equal(second.created, false)
  assert.equal(second.inspection.id, first.inspection.id)
  assert.equal(s.dbAll('Inspections').length, 1)
})

test('discarding removes the partial and its items completely', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'x' },
  ])

  s.discardInspection(inspection.id)
  s.dbResetCache()

  assert.equal(s.dbAll('Inspections').length, 0)
  assert.equal(s.dbAll('InspectionItems').length, 0, 'no orphaned rows left behind')
})

test('a finding cannot be submitted without a description', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: '' },
  ])

  assert.throws(() => s.submitInspection(inspection.id), /need a description/)
})

test('once submitted the inspector can no longer change or discard it', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' },
  ])

  const submitted = s.submitInspection(inspection.id)
  assert.equal(submitted.status, 'submitted')
  assert.equal(submitted.editable, false)

  assert.throws(() => s.submitInspection(inspection.id), /already been submitted/)
  assert.throws(() => s.discardInspection(inspection.id), /cannot be discarded/)
})

test('an inspection cannot be signed off by its own inspector', () => {
  const { s, unitA, inspector, manager } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' },
  ])
  s.submitInspection(inspection.id)

  assert.throws(() => s.signInspection(inspection.id, inspector.id), /its own inspector/)

  const signed = s.signInspection(inspection.id, manager.id)
  assert.equal(signed.status, 'signed')
  assert.ok(signed.signed_at)
})

test('a signed inspection is frozen', () => {
  const { s, unitA, inspector, manager } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' },
  ])
  s.submitInspection(inspection.id)
  s.signInspection(inspection.id, manager.id)

  assert.throws(() => s.signInspection(inspection.id, manager.id), /Only a submitted/)
  assert.throws(() => s.discardInspection(inspection.id), /cannot be discarded/)
})

test('an item from another unit template is refused', () => {
  const { s, unitA, unitB, tenant, inspector, manager } = setup()
  s.publishDraft(s.createDraft(unitB.id, tenant.id, manager.id).id)

  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const otherTemplate = s.resolveTemplate(s.getPublishedTemplate(unitB.id).id)
  const foreignItem = otherTemplate.sections[0].items[0]

  assert.throws(
    () => s.applyInspectionItems(inspection.id, [
      { template_item_id: foreignItem.id, rating: 'critical', note: 'x' },
    ]),
    /not part of this inspection/
  )
})

test('a signed record still reads as completed after the unit revises its checklist', () => {
  const { s, unitA, tenant, inspector, manager } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))
  s.applyInspectionItems(inspection.id, [
    { template_item_id: items[0].id, rating: 'critical', note: 'Guard missing' },
  ])
  s.submitInspection(inspection.id)
  s.signInspection(inspection.id, manager.id)

  assert.equal(s.resolveInspection(inspection.id).template_version, 1)

  // The unit reworks its checklist and publishes v2.
  const draft = s.createDraft(unitA.id, tenant.id, manager.id)
  const draftItems = s.resolveTemplate(draft.id).sections[0].items
  s.dbUpdate('UnitTemplateItems', draftItems[0].id, { text_override: 'CHANGED IN V2' })
  s.publishDraft(draft.id)
  s.dbResetCache()

  const after = s.resolveInspection(inspection.id)
  assert.equal(after.template_version, 1, 'the signed record is pinned to the version it used')
  assert.notEqual(flat(after)[0].text, 'CHANGED IN V2')
})

test('an unknown rating is rejected', () => {
  const { s, unitA, inspector } = setup()
  const { inspection } = s.openDraft(unitA.id, inspector.id)
  const items = flat(s.resolveInspection(inspection.id))

  assert.throws(
    () => s.applyInspectionItems(inspection.id, [
      { template_item_id: items[0].id, rating: 'looks_fine', note: '' },
    ]),
    /Unknown rating/
  )
})
