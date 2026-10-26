import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn } from './helpers.js'

async function adminOn(unitLabel = 'unitA') {
  const h = await createHarness()
  const fixture = await seedFixture(h.db)
  const token = await signIn(h.call, 'omni', 'admin-password')
  return { ...h, ...fixture, token, unit: fixture[unitLabel] }
}

test('a draft seeds from the published version and does not disturb it', async () => {
  const { call, token, unit } = await adminOn()

  const draft = await call(`/units/${unit}/template/draft`, { method: 'POST', token })
  assert.equal(draft.status, 201)
  assert.equal(draft.body.status, 'draft')
  assert.equal(draft.body.version, 2)
  assert.equal(draft.body.stats.items_effective, 303)

  const live = await call(`/units/${unit}/template`, { token })
  assert.equal(live.body.version, 1)
})

test('opening a draft twice returns the same draft rather than a second one', async () => {
  const { db, call, token, unit } = await adminOn()

  const first = await call(`/units/${unit}/template/draft`, { method: 'POST', token })
  const second = await call(`/units/${unit}/template/draft`, { method: 'POST', token })
  assert.equal(first.body.id, second.body.id)

  const { n } = await db.get(
    "SELECT COUNT(*) AS n FROM unit_templates WHERE unit_id = @u AND status = 'draft'",
    { u: unit }
  )
  assert.equal(n, 1)
})

test('disabling a section removes its items from what an inspector would be asked', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body

  const section = draft.sections[0]
  const edited = await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { sections: [{ section_id: section.section_id, enabled: false }] },
  })

  assert.equal(edited.status, 200)
  assert.equal(edited.body.stats.items_effective, draft.stats.items_effective - section.items.length)
  // The items are still there, still enabled - it is the section that is off.
  assert.equal(edited.body.stats.items_enabled, draft.stats.items_enabled)
})

test('rewording an item keeps its library identity', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body
  const item = draft.sections[0].items[0]

  const edited = await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { items: [{ id: item.id, text_override: 'Our own wording for this check' }] },
  })

  const updated = edited.body.sections[0].items[0]
  assert.equal(updated.text, 'Our own wording for this check')
  assert.equal(updated.reworded, true)
  assert.equal(updated.library_item_id, item.library_item_id)
  assert.equal(updated.code, item.code)
})

test('clearing a rewording restores the library wording', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body
  const item = draft.sections[0].items[0]

  await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { items: [{ id: item.id, text_override: 'Temporary wording' }] },
  })
  const restored = await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { items: [{ id: item.id, text_override: null }] },
  })

  const updated = restored.body.sections[0].items[0]
  assert.equal(updated.text, item.text)
  assert.equal(updated.reworded, false)
})

test('one unit cannot edit another unit’s draft items', async () => {
  const { call, token, unitA, unitB } = await adminOn()
  const a = (await call(`/units/${unitA}/template/draft`, { method: 'POST', token })).body
  await call(`/units/${unitB}/template/draft`, { method: 'POST', token })

  const res = await call(`/units/${unitB}/template/draft`, {
    method: 'PATCH',
    token,
    body: { items: [{ id: a.sections[0].items[0].id, enabled: false }] },
  })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /not part of this draft/)
})

test('a custom item is added to the unit and carried into the next version', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body

  const added = await call(`/units/${unit}/template/draft/items`, {
    method: 'POST',
    token,
    body: { section_id: draft.sections[0].section_id, text: 'Check the de-icing bay drain' },
  })
  assert.equal(added.status, 201)
  assert.equal(added.body.stats.items_custom, 1)

  await call(`/units/${unit}/template/draft/publish`, { method: 'POST', token })
  const next = await call(`/units/${unit}/template/draft`, { method: 'POST', token })
  assert.equal(next.body.stats.items_custom, 1)
})

test('publishing archives the previous version and bumps the live one', async () => {
  const { call, token, unit } = await adminOn()
  await call(`/units/${unit}/template/draft`, { method: 'POST', token })

  const published = await call(`/units/${unit}/template/draft/publish`, { method: 'POST', token })
  assert.equal(published.status, 200)
  assert.equal(published.body.version, 2)
  assert.equal(published.body.status, 'published')

  const versions = await call(`/units/${unit}/template/versions`, { token })
  assert.deepEqual(
    versions.body.map((v) => [v.version, v.status]),
    [
      [2, 'published'],
      [1, 'archived'],
    ]
  )
})

test('a checklist with nothing enabled cannot be published', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body

  await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { sections: draft.sections.map((s) => ({ section_id: s.section_id, enabled: false })) },
  })

  const res = await call(`/units/${unit}/template/draft/publish`, { method: 'POST', token })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /no enabled items/)
})

test('discarding a draft leaves the published version alone', async () => {
  const { call, token, unit } = await adminOn()
  await call(`/units/${unit}/template/draft`, { method: 'POST', token })

  assert.equal((await call(`/units/${unit}/template/draft`, { method: 'DELETE', token })).status, 204)
  assert.equal((await call(`/units/${unit}/template/draft`, { token })).status, 404)
  assert.equal((await call(`/units/${unit}/template`, { token })).body.version, 1)
})

test('an archived version still renders, so old inspections stay readable', async () => {
  const { call, token, unit } = await adminOn()
  const draft = (await call(`/units/${unit}/template/draft`, { method: 'POST', token })).body
  await call(`/units/${unit}/template/draft`, {
    method: 'PATCH',
    token,
    body: { items: [{ id: draft.sections[0].items[0].id, enabled: false }] },
  })
  await call(`/units/${unit}/template/draft/publish`, { method: 'POST', token })

  const v1 = await call(`/units/${unit}/template/versions/1`, { token })
  assert.equal(v1.status, 200)
  assert.equal(v1.body.stats.items_effective, 303)

  const v2 = await call(`/units/${unit}/template/versions/2`, { token })
  assert.equal(v2.body.stats.items_effective, 302)
})

test('the library is available for adding items back in', async () => {
  const { call, token, unit } = await adminOn()
  const res = await call(`/units/${unit}/template/library`, { token })

  assert.equal(res.status, 200)
  assert.equal(res.body.length, 16)
  const items = res.body.flatMap((s) => s.groups).flatMap((g) => g.items)
  assert.equal(items.length, 303)
})
