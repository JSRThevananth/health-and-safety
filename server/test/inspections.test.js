import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'

const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')
const { createDraft, publishDraft } = await import('../src/services/formTemplates.js')

const db = getDb()
const fx = seedTenant(db)
// Both units need a published checklist to inspect against.
for (const unitId of [fx.unitA, fx.unitB]) {
  publishDraft(createDraft(unitId, fx.tenantId, fx.admin).id)
}

const server = await startServer(createApp)
test.after(() => server.close())

const tokenFor = async (u) =>
  (await server.request('POST', '/auth/login', { json: { username: u, password: 'password123' } }))
    .body.access_token

const inspector = await tokenFor('inspector')
const manager = await tokenFor('manager')
const admin = await tokenFor('admin')

const firstItems = (insp, n) => insp.sections.flatMap((s) => s.items).slice(0, n)

async function freshDraft() {
  const existing = await server.request('GET', `/inspections/draft?unit_id=${fx.unitA}`, { token: inspector })
  if (existing.status === 200) {
    await server.request('DELETE', `/inspections/${existing.body.id}`, { token: inspector })
  }
  return (await server.request('POST', '/inspections/draft', {
    token: inspector,
    json: { unit_id: fx.unitA },
  })).body
}

test('starting an inspection creates a draft with every item defaulted to satisfactory', async () => {
  const draft = await freshDraft()
  assert.equal(draft.status, 'draft')
  assert.equal(draft.editable, true)
  assert.equal(draft.summary_counts.total, 303)
  assert.equal(draft.summary_counts.satisfactory, 303)
  assert.equal(draft.summary_counts.touched, 0)
  assert.equal(draft.summary_counts.untouched, 303)
})

test('a partial inspection is saved and can be resumed', async () => {
  const draft = await freshDraft()
  const [a, b] = firstItems(draft, 2)

  const saved = await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: {
      department: 'Hot Kitchen',
      items: [
        { template_item_id: a.id, rating: 'critical', note: 'Residue on the conveyor' },
        { template_item_id: b.id, rating: 'needs_improvement', note: 'Boots worn' },
      ],
    },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.summary_counts.critical, 1)
  assert.equal(saved.body.summary_counts.exceptions, 2)
  assert.equal(saved.body.summary_counts.touched, 2)

  // Resume: a completely separate request, as if they reopened the app later.
  const resumed = await server.request('GET', `/inspections/draft?unit_id=${fx.unitA}`, { token: inspector })
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.id, draft.id)
  assert.equal(resumed.body.department, 'Hot Kitchen')
  const item = resumed.body.sections.flatMap((s) => s.items).find((i) => i.id === a.id)
  assert.equal(item.rating, 'critical')
  assert.equal(item.note, 'Residue on the conveyor')
})

test('the data really is in the database, not in the response', async () => {
  const draft = await server.request('GET', `/inspections/draft?unit_id=${fx.unitA}`, { token: inspector })
  const rows = db
    .prepare('SELECT rating, note FROM inspection_items WHERE inspection_id = ? ORDER BY id')
    .all(draft.body.id)
  assert.equal(rows.length, 2, 'only touched items are stored')
  assert.equal(rows[0].rating, 'critical')
  assert.equal(rows[0].note, 'Residue on the conveyor')
})

test('starting a second draft returns the same one rather than duplicating', async () => {
  const again = await server.request('POST', '/inspections/draft', {
    token: inspector,
    json: { unit_id: fx.unitA },
  })
  assert.equal(again.status, 200, 'existing draft, not newly created')
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM inspections WHERE unit_id = ? AND inspector_id = ? AND status = 'draft'`)
    .get(fx.unitA, fx.inspector).n
  assert.equal(count, 1, 'never more than one open draft per inspector per unit')
})

test('resetting discards the partial data completely', async () => {
  const draft = (await server.request('GET', `/inspections/draft?unit_id=${fx.unitA}`, { token: inspector })).body

  const removed = await server.request('DELETE', `/inspections/${draft.id}`, { token: inspector })
  assert.equal(removed.status, 204)

  const gone = await server.request('GET', `/inspections/draft?unit_id=${fx.unitA}`, { token: inspector })
  assert.equal(gone.status, 404)

  // The item rows must go too, not linger as orphans.
  const orphans = db
    .prepare('SELECT COUNT(*) AS n FROM inspection_items WHERE inspection_id = ?')
    .get(draft.id).n
  assert.equal(orphans, 0)

  const fresh = await server.request('POST', '/inspections/draft', {
    token: inspector,
    json: { unit_id: fx.unitA },
  })
  assert.equal(fresh.status, 201)
  assert.equal(fresh.body.summary_counts.touched, 0, 'a clean sheet')
})

test('undoing a rating returns the item to untouched', async () => {
  const draft = await freshDraft()
  const [item] = firstItems(draft, 1)

  await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: { items: [{ template_item_id: item.id, rating: 'critical', note: 'oops, wrong row' }] },
  })
  const undone = await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: { items: [{ template_item_id: item.id, rating: 'satisfactory', note: '' }] },
  })
  assert.equal(undone.body.summary_counts.touched, 0, 'not recorded as an explicit pass')
  assert.equal(undone.body.summary_counts.untouched, 303)
})

test('a finding cannot be submitted without a description', async () => {
  const draft = await freshDraft()
  const [item] = firstItems(draft, 1)
  await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: { items: [{ template_item_id: item.id, rating: 'critical', note: '' }] },
  })

  const { status, body } = await server.request('POST', `/inspections/${draft.id}/submit`, { token: inspector })
  assert.equal(status, 422)
  assert.match(body.error, /need a description/)
})

test('once submitted, the inspector can no longer change it', async () => {
  const draft = await freshDraft()
  const [item] = firstItems(draft, 1)
  await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Guard missing' }] },
  })

  const submitted = await server.request('POST', `/inspections/${draft.id}/submit`, { token: inspector })
  assert.equal(submitted.status, 200)
  assert.equal(submitted.body.status, 'submitted')
  assert.equal(submitted.body.editable, false)

  const edit = await server.request('PATCH', `/inspections/${draft.id}`, {
    token: inspector,
    json: { items: [{ template_item_id: item.id, rating: 'satisfactory', note: '' }] },
  })
  assert.equal(edit.status, 409)
  assert.equal(edit.body.code, 'INSPECTION_LOCKED')

  const discard = await server.request('DELETE', `/inspections/${draft.id}`, { token: inspector })
  assert.equal(discard.status, 409, 'nor can it be deleted to cover something up')
})

test('an inspector cannot sign off their own inspection', async () => {
  const submitted = db
    .prepare(`SELECT id FROM inspections WHERE status = 'submitted' ORDER BY id DESC LIMIT 1`)
    .get()

  // The inspector lacks the permission outright.
  const bySelf = await server.request('POST', `/inspections/${submitted.id}/sign`, { token: inspector })
  assert.equal(bySelf.status, 403)

  const byManager = await server.request('POST', `/inspections/${submitted.id}/sign`, { token: manager })
  assert.equal(byManager.status, 200)
  assert.equal(byManager.body.status, 'signed')
  assert.ok(byManager.body.signed_at)
})

test('a signed inspection is frozen for everyone', async () => {
  const signed = db
    .prepare(`SELECT id FROM inspections WHERE status = 'signed' ORDER BY id DESC LIMIT 1`)
    .get()

  const edit = await server.request('PATCH', `/inspections/${signed.id}`, {
    token: inspector,
    json: { items: [] },
  })
  assert.equal(edit.status, 409)

  const reSign = await server.request('POST', `/inspections/${signed.id}/sign`, { token: manager })
  assert.equal(reSign.status, 409)
})

test('inspections are scoped to the unit, like everything else', async () => {
  const other = await server.request('POST', '/inspections/draft', {
    token: inspector,
    json: { unit_id: fx.unitB },
  })
  assert.equal(other.status, 403, 'an inspector cannot open a draft on a unit they do not hold')

  const adminDraft = await server.request('POST', '/inspections/draft', {
    token: admin,
    json: { unit_id: fx.unitB },
  })
  assert.equal(adminDraft.status, 201, 'an omni admin can')

  const list = await server.request('GET', '/inspections', { token: inspector })
  assert.ok(list.body.every((i) => i.unit_id === fx.unitA), 'the list never leaks another unit')
})

test('an inspection pins its template version, so later form edits do not rewrite it', async () => {
  const signed = db
    .prepare(`SELECT * FROM inspections WHERE status = 'signed' ORDER BY id DESC LIMIT 1`)
    .get()
  const record = await server.request('GET', `/inspections/${signed.id}`, { token: manager })
  assert.equal(record.body.template_version, 1)

  // The unit now revises its checklist and publishes v2.
  const draft = createDraft(fx.unitA, fx.tenantId, fx.admin)
  publishDraft(draft.id)

  const after = await server.request('GET', `/inspections/${signed.id}`, { token: manager })
  assert.equal(after.body.template_version, 1, 'the signed record still reads as it was completed')
})
