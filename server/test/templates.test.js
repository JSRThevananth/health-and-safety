import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpDir, startServer } from './helpers.js'
import { seedTenant } from './fixtures.js'


const { createApp } = await import('../src/app.js')
const { getDb } = await import('../src/db/index.js')

const db = getDb()
const fx = seedTenant(db)
const server = await startServer(createApp)
test.after(() => server.close())

const tokenFor = async (username) =>
  (await server.request('POST', '/auth/login', { json: { username, password: 'password123' } }))
    .body.access_token

const manager = await tokenFor('manager')
const inspector = await tokenFor('inspector')
const admin = await tokenFor('admin')

const base = `/units/${fx.unitA}/template`
const findItem = (tpl, code) => tpl.sections.flatMap((s) => s.items).find((i) => i.code === code)

test('the library carries all 303 items from the source checklist', async () => {
  const { body } = await server.request('GET', `${base}/library`, { token: manager })
  assert.equal(body.length, 16)
  const items = body.flatMap((s) => s.groups.flatMap((g) => g.items))
  assert.equal(items.length, 303)
  assert.ok(items.some((i) => i.code === 'S01.G01.I01'))
})

test('a first draft seeds the whole library, all enabled', async () => {
  const { status, body } = await server.request('POST', `${base}/draft`, { token: manager })
  assert.equal(status, 201)
  assert.equal(body.version, 1)
  assert.equal(body.status, 'draft')
  assert.equal(body.stats.items_total, 303)
  assert.equal(body.stats.items_enabled, 303)
})

test('opening a draft twice returns the same draft, not a second one', async () => {
  const again = await server.request('POST', `${base}/draft`, { token: manager })
  assert.equal(again.body.version, 1)
  const versions = await server.request('GET', `${base}/versions`, { token: manager })
  assert.equal(versions.body.length, 1)
})

test('a unit can disable a whole section and individual items', async () => {
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  const dishwashing = draft.sections.find((s) => s.code === 'S07')
  const item = findItem(draft, 'S01.G01.I02')

  const { body } = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: {
      sections: [{ section_id: dishwashing.section_id, enabled: false }],
      items: [{ id: item.id, enabled: false }],
    },
  })

  assert.equal(body.sections.find((s) => s.code === 'S07').enabled, false)
  assert.equal(findItem(body, 'S01.G01.I02').enabled, false)
  assert.equal(body.stats.items_enabled, 302)
})

test('rewording an item keeps its library identity', async () => {
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  const item = findItem(draft, 'S01.G01.I01')
  const originalLibraryId = item.library_item_id

  const { body } = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { items: [{ id: item.id, text_override: 'Required PPE is signposted at every entrance.' }] },
  })

  const edited = findItem(body, 'S01.G01.I01')
  assert.equal(edited.text, 'Required PPE is signposted at every entrance.')
  assert.equal(edited.reworded, true)
  // This is what keeps cross-unit comparison and recurrence detection working.
  assert.equal(edited.library_item_id, originalLibraryId)
  assert.equal(edited.code, 'S01.G01.I01')
})

test('clearing a rewording restores the library wording', async () => {
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  const item = findItem(draft, 'S01.G01.I01')

  const { body } = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { items: [{ id: item.id, text_override: null }] },
  })
  const restored = findItem(body, 'S01.G01.I01')
  assert.equal(restored.text, 'Required PPE is clearly identified for the work area.')
  assert.equal(restored.reworded, false)
})

test('a unit can add its own item', async () => {
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  const section = draft.sections.find((s) => s.code === 'S10')

  const { status, body } = await server.request('POST', `${base}/draft/items`, {
    token: manager,
    json: {
      section_id: section.section_id,
      text: 'De-icing fluid spill kit is present at the apron door.',
      risk_weight: 2,
    },
  })
  assert.equal(status, 201)
  assert.equal(body.stats.items_custom, 1)

  const custom = body.sections
    .flatMap((s) => s.items)
    .find((i) => i.text.startsWith('De-icing fluid'))
  assert.ok(custom.is_custom)
  assert.equal(custom.risk_weight, 2)
})

test('a draft cannot edit another unit template items', async () => {
  // Open a draft on unit B, then try to edit its items through unit A's route.
  const adminToken = admin
  const other = await server.request('POST', `/units/${fx.unitB}/template/draft`, { token: adminToken })
  const otherItemId = other.body.sections.flatMap((s) => s.items)[0].id

  const { status, body } = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { items: [{ id: otherItemId, enabled: false }] },
  })
  assert.equal(status, 422)
  assert.match(body.error, /not part of this draft/)
})

test('publishing freezes the version and starts a new one', async () => {
  const published = await server.request('POST', `${base}/draft/publish`, { token: manager })
  assert.equal(published.status, 200)
  assert.equal(published.body.status, 'published')
  assert.equal(published.body.version, 1)

  const live = await server.request('GET', base, { token: inspector })
  assert.equal(live.body.version, 1)

  // A new draft carries the customisation forward as version 2.
  const next = await server.request('POST', `${base}/draft`, { token: manager })
  assert.equal(next.body.version, 2)
  assert.equal(next.body.status, 'draft')
  assert.equal(next.body.stats.items_custom, 1, 'custom items carry into the next version')
})

test('a published version is immutable once superseded', async () => {
  // Change something in the v2 draft, publish it, then re-read v1.
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  const item = findItem(draft, 'S01.G02.I01')
  await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { items: [{ id: item.id, text_override: 'CHANGED IN V2' }] },
  })
  await server.request('POST', `${base}/draft/publish`, { token: manager })

  const v1 = await server.request('GET', `${base}/versions/1`, { token: manager })
  const v2 = await server.request('GET', `${base}/versions/2`, { token: manager })

  assert.equal(v1.body.status, 'archived')
  assert.equal(v2.body.status, 'published')
  assert.notEqual(findItem(v1.body, 'S01.G02.I01').text, 'CHANGED IN V2')
  assert.equal(findItem(v2.body, 'S01.G02.I01').text, 'CHANGED IN V2')
})

test('an inspector may read the checklist but not edit it', async () => {
  assert.equal((await server.request('GET', base, { token: inspector })).status, 200)

  const edit = await server.request('POST', `${base}/draft`, { token: inspector })
  assert.equal(edit.status, 403)
  assert.match(edit.body.error, /Missing permission: template\.edit/)
})

test('a manager cannot touch another unit checklist', async () => {
  const { status } = await server.request('GET', `/units/${fx.unitB}/template`, { token: manager })
  assert.equal(status, 403)
})

test('a checklist with no enabled items cannot be published', async () => {
  await server.request('POST', `${base}/draft`, { token: manager })
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { items: draft.sections.flatMap((s) => s.items).map((i) => ({ id: i.id, enabled: false })) },
  })

  const { status, body } = await server.request('POST', `${base}/draft/publish`, { token: manager })
  assert.equal(status, 422)
  assert.match(body.error, /no enabled items/)
})

test('disabling a section removes its items from the effective form', async () => {
  // Start from a clean draft: earlier tests left one with items disabled.
  await server.request('DELETE', `${base}/draft`, { token: manager })
  await server.request('POST', `${base}/draft`, { token: manager })
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body

  // Explicitly enable the section first - an earlier test may already have disabled it.
  const dish = draft.sections.find((s) => s.code === 'S07')
  const enabled = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: {
      sections: [{ section_id: dish.section_id, enabled: true }],
      items: dish.items.map((i) => ({ id: i.id, enabled: true })),
    },
  })
  const dishItemCount = enabled.body.sections.find((s) => s.code === 'S07').items.length
  const before = enabled.body.stats.items_effective
  assert.ok(dishItemCount > 0)

  const after = await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { sections: [{ section_id: dish.section_id, enabled: false }] },
  })

  // The items still exist and keep their own flags; they are simply not asked.
  assert.equal(after.body.stats.items_total, draft.stats.items_total)
  assert.equal(after.body.stats.items_effective, before - dishItemCount)
})

test('a checklist whose every section is disabled cannot be published', async () => {
  const draft = (await server.request('GET', `${base}/draft`, { token: manager })).body
  await server.request('PATCH', `${base}/draft`, {
    token: manager,
    json: { sections: draft.sections.map((s) => ({ section_id: s.section_id, enabled: false })) },
  })

  const { status, body } = await server.request('POST', `${base}/draft/publish`, { token: manager })
  assert.equal(status, 422)
  assert.match(body.error, /no enabled items/)
})
