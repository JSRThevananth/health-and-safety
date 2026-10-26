import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'

async function onShift() {
  const h = await createHarness()
  const fixture = await seedFixture(h.db)
  const token = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body
  return { ...h, ...fixture, token, draft }
}

const firstItems = (inspection, n) => inspection.sections[0].items.slice(0, n)

test('a new inspection starts with everything satisfactory and nothing touched', async () => {
  const { draft } = await onShift()

  assert.equal(draft.status, 'draft')
  assert.equal(draft.summary_counts.total, 303)
  assert.equal(draft.summary_counts.satisfactory, 303)
  assert.equal(draft.summary_counts.touched, 0)
  assert.equal(draft.summary_counts.untouched, 303)
  assert.equal(draft.summary_counts.exceptions, 0)
})

test('only the exceptions an inspector records are stored', async () => {
  const { db, call, token, draft } = await onShift()
  const [a, b] = firstItems(draft, 2)

  const saved = await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: {
      items: [
        { template_item_id: a.id, rating: 'critical', note: 'Fire door wedged open' },
        { template_item_id: b.id, rating: 'needs_improvement', note: 'Scuffed floor marking' },
      ],
    },
  })

  assert.equal(saved.status, 200)
  assert.equal(saved.body.summary_counts.critical, 1)
  assert.equal(saved.body.summary_counts.needs_improvement, 1)
  assert.equal(saved.body.summary_counts.satisfactory, 301)
  assert.equal(saved.body.summary_counts.touched, 2)

  // 303 items on the form, two rows in the database.
  const { n } = await db.get('SELECT COUNT(*) AS n FROM inspection_items WHERE inspection_id = @i', {
    i: draft.id,
  })
  assert.equal(n, 2)
})

test('undoing a finding returns the item to untouched rather than an explicit pass', async () => {
  const { db, call, token, draft } = await onShift()
  const [item] = firstItems(draft, 1)

  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Mistake' }] },
  })
  const undone = await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'satisfactory', note: '' }] },
  })

  assert.equal(undone.body.summary_counts.touched, 0)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM inspection_items WHERE inspection_id = @i', {
    i: draft.id,
  })
  assert.equal(n, 0)
})

test('a satisfactory rating with a note is kept, because the note is the point', async () => {
  const { call, token, draft } = await onShift()
  const [item] = firstItems(draft, 1)

  const saved = await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: {
      items: [{ template_item_id: item.id, rating: 'satisfactory', note: 'Repaired during the walk' }],
    },
  })
  assert.equal(saved.body.summary_counts.touched, 1)
  assert.equal(saved.body.sections[0].items[0].note, 'Repaired during the walk')
})

test('resuming returns the inspector to their own partial work', async () => {
  const { call, token, draft, unitA } = await onShift()
  const [item] = firstItems(draft, 1)

  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { department: 'Hot Kitchen', items: [{ template_item_id: item.id, rating: 'critical', note: 'Leak' }] },
  })

  const resumed = await call(`/inspections/draft?unit_id=${unitA}`, { token })
  assert.equal(resumed.status, 200)
  assert.equal(resumed.body.id, draft.id)
  assert.equal(resumed.body.department, 'Hot Kitchen')
  assert.equal(resumed.body.summary_counts.critical, 1)
})

test('an autosave lands whole or not at all', async () => {
  const { db, call, token, draft } = await onShift()
  const items = firstItems(draft, 3)

  // The last id does not belong to this inspection, so the whole save is refused -
  // and the two valid findings in the same request must not be half-written.
  const res = await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: {
      items: [
        { template_item_id: items[0].id, rating: 'critical', note: 'One' },
        { template_item_id: items[1].id, rating: 'critical', note: 'Two' },
        { template_item_id: 999999, rating: 'critical', note: 'Not ours' },
      ],
    },
  })

  assert.equal(res.status, 422)
  const { n } = await db.get('SELECT COUNT(*) AS n FROM inspection_items WHERE inspection_id = @i', {
    i: draft.id,
  })
  assert.equal(n, 0)
})

test('an undescribed finding blocks submission and names what is missing', async () => {
  const { call, token, draft } = await onShift()
  const [item] = firstItems(draft, 1)

  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: '   ' }] },
  })

  await signInspection(call, token, draft.id)
  const res = await call(`/inspections/${draft.id}/submit`, { method: 'POST', token })
  assert.equal(res.status, 422)
  assert.equal(res.body.items[0].code, item.code)
})

test('a submitted inspection can no longer be changed or discarded by its inspector', async () => {
  const { call, token, draft } = await onShift()
  const [item] = firstItems(draft, 1)

  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })

  await signInspection(call, token, draft.id)
  const submitted = await call(`/inspections/${draft.id}/submit`, { method: 'POST', token })
  assert.equal(submitted.status, 200)
  assert.equal(submitted.body.status, 'submitted')
  assert.equal(submitted.body.editable, false)

  const edit = await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { summary: 'Actually it was fine' },
  })
  assert.equal(edit.status, 409)
  assert.equal(edit.body.code, 'INSPECTION_LOCKED')

  assert.equal((await call(`/inspections/${draft.id}`, { method: 'DELETE', token })).status, 409)
})

test('an inspection cannot be signed off by the person who carried it out', async () => {
  const { db, call, token, draft } = await onShift()
  const [item] = firstItems(draft, 1)
  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })
  await signInspection(call, token, draft.id)
  await call(`/inspections/${draft.id}/submit`, { method: 'POST', token })

  // Give the inspector the sign-off permission so the refusal is about who they
  // are, not what they are allowed to do.
  await db.run(
    `INSERT INTO user_permissions (user_id, permission, granted)
     SELECT id, 'inspection.sign', 1 FROM users WHERE username = 'lhr.inspector'`
  )
  const ownToken = await signIn(call, 'lhr.inspector', 'inspector-password')
  const own = await call(`/inspections/${draft.id}/sign`, { method: 'POST', token: ownToken })
  assert.equal(own.status, 409)

  const manager = await signIn(call, 'lhr.manager', 'manager-password')
  const signed = await call(`/inspections/${draft.id}/sign`, { method: 'POST', token: manager })
  assert.equal(signed.status, 200)
  assert.equal(signed.body.status, 'signed')
})

test('an unsubmitted inspection cannot be signed off', async () => {
  const { call, draft } = await onShift()
  const manager = await signIn(call, 'lhr.manager', 'manager-password')

  const res = await call(`/inspections/${draft.id}/sign`, { method: 'POST', token: manager })
  assert.equal(res.status, 409)
})

test('starting over discards the partial', async () => {
  const { call, token, draft, unitA } = await onShift()
  const [item] = firstItems(draft, 1)
  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Leak' }] },
  })

  assert.equal((await call(`/inspections/${draft.id}`, { method: 'DELETE', token })).status, 204)
  assert.equal((await call(`/inspections/draft?unit_id=${unitA}`, { token })).status, 404)

  const fresh = await call('/inspections/draft', { method: 'POST', token, body: { unit_id: unitA } })
  assert.equal(fresh.status, 201)
  assert.equal(fresh.body.summary_counts.touched, 0)
})

test('an inspection renders against the version it was filled on, not the current one', async () => {
  const { call, token, draft, unitA } = await onShift()
  const [item] = firstItems(draft, 1)
  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })
  await signInspection(call, token, draft.id)
  await call(`/inspections/${draft.id}/submit`, { method: 'POST', token })

  // The unit now rewrites its form and publishes v2.
  const admin = await signIn(call, 'admin', 'admin-password')
  const newDraft = (await call(`/units/${unitA}/template/draft`, { method: 'POST', token: admin })).body
  await call(`/units/${unitA}/template/draft`, {
    method: 'PATCH',
    token: admin,
    body: { sections: [{ section_id: newDraft.sections[0].section_id, enabled: false }] },
  })
  await call(`/units/${unitA}/template/draft/publish`, { method: 'POST', token: admin })

  const reread = await call(`/inspections/${draft.id}`, { token })
  assert.equal(reread.body.template_version, 1)
  assert.equal(reread.body.summary_counts.total, 303)
  assert.equal(reread.body.sections[0].items[0].note, 'Fire door wedged open')
})

test('a unit with no published checklist cannot start an inspection', async () => {
  const { db, call } = await createHarness()
  const { tenantId } = await seedFixture(db)
  const token = await signIn(call, 'admin', 'admin-password')

  const { id: emptyUnit } = await db.insert(
    "INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Brand New Unit', 'NEW')",
    { t: tenantId }
  )

  const res = await call('/inspections/draft', { method: 'POST', token, body: { unit_id: emptyUnit } })
  assert.equal(res.status, 409)
  assert.match(res.body.error, /no published checklist/)
})

test('the list shows each inspection’s exception count', async () => {
  const { call, token, draft } = await onShift()
  const items = firstItems(draft, 3)

  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: {
      items: [
        { template_item_id: items[0].id, rating: 'critical', note: 'One' },
        { template_item_id: items[1].id, rating: 'needs_improvement', note: 'Two' },
        { template_item_id: items[2].id, rating: 'na', note: 'Not applicable here' },
      ],
    },
  })

  const list = await call('/inspections', { token })
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].exception_count, 2)
  assert.equal(list.body[0].unit_name, 'Heathrow Catering Unit')
})
