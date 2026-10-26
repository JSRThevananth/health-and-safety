import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'
import { defaultDueDate, isOverdue, priorityForRating } from '../src/services/capas.js'

/**
 * Corrective actions.
 *
 * The inspection records that something was wrong; this records that somebody
 * fixed it. The tests below are mostly about the two things an audit turns on:
 * that an action cannot be closed without saying what was done, and that the
 * history cannot be rewritten after the fact.
 */

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

/** A submitted inspection with one critical finding, plus signed-in callers. */
async function withFinding() {
  const h = await createHarness()
  const fixture = await seedFixture(h.db)

  const inspector = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const manager = await signIn(h.call, 'lhr.manager', 'manager-password')
  const other = await signIn(h.call, 'dxb.inspector', 'inspector-password')

  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: fixture.unitA } })
  ).body
  const [first, second] = draft.sections[0].items
  await h.call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token: inspector,
    body: {
      items: [
        { template_item_id: first.id, rating: 'critical', note: 'Fire door wedged open' },
        { template_item_id: second.id, rating: 'needs_improvement', note: 'Chipped tile' },
      ],
    },
  })
  await signInspection(h.call, inspector, draft.id)
  await h.call(`/inspections/${draft.id}/submit`, { method: 'POST', token: inspector })

  return { ...h, ...fixture, inspector, manager, other, draft, first, second }
}

/* -------------------------------------------------------------- defaults -- */

test('a critical finding is high priority, and high priority is due soonest', () => {
  assert.equal(priorityForRating('critical'), 'high')
  assert.equal(priorityForRating('needs_improvement'), 'normal')

  const from = new Date('2026-10-10T00:00:00Z')
  assert.equal(defaultDueDate('high', from), '2026-10-13')
  assert.equal(defaultDueDate('normal', from), '2026-10-24')
  assert.equal(defaultDueDate('low', from), '2026-11-09')
  // An unknown priority gets the ordinary window rather than no date at all.
  assert.equal(defaultDueDate('whatever', from), '2026-10-24')
})

test('overdue means open and past its date, nothing else', () => {
  assert.equal(isOverdue({ status: 'open', due_date: '2026-01-01' }, '2026-02-01'), true)
  assert.equal(isOverdue({ status: 'open', due_date: '2026-03-01' }, '2026-02-01'), false)
  // A closed action is not overdue, however late it was.
  assert.equal(isOverdue({ status: 'done', due_date: '2026-01-01' }, '2026-02-01'), false)
  assert.equal(isOverdue({ status: 'open', due_date: null }, '2026-02-01'), false)
})

/* --------------------------------------------------------------- raising -- */

test('an action can be raised on its own, without an inspection', async () => {
  const { call, manager, unitA } = await withFinding()

  const res = await call('/capas', {
    method: 'POST',
    token: manager,
    body: { unit_id: unitA, title: 'Replace the damaged pallet truck', priority: 'high' },
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.status, 'open')
  assert.equal(res.body.priority, 'high')
  // A hazard noticed on the way to the office should not have to wait for an
  // inspection to exist.
  assert.equal(res.body.inspection_id, null)
  assert.ok(res.body.due_date, 'it should get a default due date')
})

test('actions are raised from the findings in one go', async () => {
  const { call, manager, draft, first, second } = await withFinding()

  const res = await call(`/capas/from-inspection/${draft.id}`, {
    method: 'POST',
    token: manager,
    body: { template_item_ids: [first.id, second.id] },
  })

  assert.equal(res.status, 201)
  assert.equal(res.body.created, 2)

  const [critical, improvement] = res.body.capas
  // The wording and the note come from the inspection, so nobody retypes them.
  assert.match(critical.title, /\S/)
  assert.equal(critical.detail, 'Fire door wedged open')
  assert.equal(critical.priority, 'high')
  assert.equal(improvement.priority, 'normal')
  assert.equal(critical.inspection_id, draft.id)
})

test('pressing it twice does not raise the same action again', async () => {
  const { call, manager, draft, first, second } = await withFinding()

  await call(`/capas/from-inspection/${draft.id}`, {
    method: 'POST',
    token: manager,
    body: { template_item_ids: [first.id] },
  })
  const again = await call(`/capas/from-inspection/${draft.id}`, {
    method: 'POST',
    token: manager,
    body: { template_item_ids: [first.id, second.id] },
  })

  assert.equal(again.body.created, 1, 'only the finding that had none')
  assert.equal(again.body.skipped, 1)
})

test('a finding from another inspection is refused', async () => {
  const { call, manager, draft, unitB } = await withFinding()

  const res = await call(`/capas/from-inspection/${draft.id}`, {
    method: 'POST',
    token: manager,
    body: { template_item_ids: [99999] },
  })
  assert.equal(res.status, 422)

  // And an inspection cannot be hung off a unit it does not belong to.
  const crossed = await call('/capas', {
    method: 'POST',
    token: manager,
    body: { unit_id: unitB, title: 'Cross-unit action', inspection_id: draft.id },
  })
  assert.equal(crossed.status, 404, 'the manager cannot reach unit B at all')
})

/* ------------------------------------------------------------- the cycle -- */

test('raise, assign, close - and the history records each step', async () => {
  const { call, db, manager, unitA, inspector: _inspector } = await withFinding()
  const inspectorId = (await db.get("SELECT id FROM users WHERE username = 'lhr.inspector'")).id

  const raised = (
    await call('/capas', {
      method: 'POST',
      token: manager,
      body: { unit_id: unitA, title: 'Fit a door closer', detail: 'Fire door 3' },
    })
  ).body

  const assigned = await call(`/capas/${raised.id}`, {
    method: 'PATCH',
    token: manager,
    body: { owner_id: inspectorId, due_date: '2026-12-01', priority: 'high' },
  })
  assert.equal(assigned.status, 200)
  assert.equal(assigned.body.owner_id, inspectorId)
  assert.equal(assigned.body.owner_name, 'lhr.inspector')
  assert.equal(assigned.body.due_date, '2026-12-01')

  const closed = await call(`/capas/${raised.id}/close`, {
    method: 'POST',
    token: manager,
    body: { note: 'Closer fitted and tested, 11 Oct' },
  })
  assert.equal(closed.status, 200)
  assert.equal(closed.body.status, 'done')
  assert.equal(closed.body.closing_note, 'Closer fitted and tested, 11 Oct')
  assert.ok(closed.body.closed_at)

  const detail = await call(`/capas/${raised.id}`, { token: manager })
  const kinds = detail.body.events.map((e) => e.kind)
  // "When was it raised, how long did it sit unassigned, who signed it off" is
  // the audit question, and none of it survives updating a row in place.
  assert.deepEqual(kinds, ['raised', 'assigned', 'closed'])
  assert.match(detail.body.events[1].detail, /Owner: unassigned ->/)
  assert.match(detail.body.events[1].detail, /Priority: normal -> high/)
})

test('closing without saying what was done is refused', async () => {
  const { call, manager, unitA } = await withFinding()
  const capa = (
    await call('/capas', { method: 'POST', token: manager, body: { unit_id: unitA, title: 'Mop the floor' } })
  ).body

  const res = await call(`/capas/${capa.id}/close`, { method: 'POST', token: manager, body: { note: '' } })
  assert.equal(res.status, 422)
  // The whole point of the table: a tick is not evidence.
  assert.match(JSON.stringify(res.body), /at least 3/i)
})

test('a closed action cannot be quietly edited, but it can be reopened', async () => {
  const { call, manager, unitA } = await withFinding()
  const capa = (
    await call('/capas', { method: 'POST', token: manager, body: { unit_id: unitA, title: 'Mop the floor' } })
  ).body
  await call(`/capas/${capa.id}/close`, { method: 'POST', token: manager, body: { note: 'Mopped' } })

  const edit = await call(`/capas/${capa.id}`, { method: 'PATCH', token: manager, body: { priority: 'low' } })
  assert.equal(edit.status, 409)

  const again = await call(`/capas/${capa.id}/close`, {
    method: 'POST',
    token: manager,
    body: { note: 'Mopped again' },
  })
  assert.equal(again.status, 409, 'and it cannot be closed twice')

  const reopened = await call(`/capas/${capa.id}/reopen`, {
    method: 'POST',
    token: manager,
    body: { reason: 'Floor still wet the next morning' },
  })
  assert.equal(reopened.status, 200)
  assert.equal(reopened.body.status, 'open')
  assert.equal(reopened.body.closing_note, '')

  const detail = await call(`/capas/${capa.id}`, { token: manager })
  // Reopening adds to the history; it does not erase the close that happened.
  assert.deepEqual(detail.body.events.map((e) => e.kind), ['raised', 'closed', 'reopened'])
})

test('a save that changes nothing does not litter the history', async () => {
  const { call, manager, unitA } = await withFinding()
  const capa = (
    await call('/capas', {
      method: 'POST',
      token: manager,
      body: { unit_id: unitA, title: 'Mop the floor', priority: 'normal' },
    })
  ).body

  await call(`/capas/${capa.id}`, { method: 'PATCH', token: manager, body: { priority: 'normal' } })
  const detail = await call(`/capas/${capa.id}`, { token: manager })
  assert.deepEqual(detail.body.events.map((e) => e.kind), ['raised'])
})

/* ------------------------------------------------------------ the lists -- */

test('the list is a worklist: open first, soonest due at the top', async () => {
  const { call, manager, unitA } = await withFinding()
  const make = async (title, due) =>
    (await call('/capas', { method: 'POST', token: manager, body: { unit_id: unitA, title, due_date: due } })).body

  const late = await make('Due last', '2026-12-31')
  const soon = await make('Due first', '2026-11-01')
  const done = await make('Already handled', '2026-10-01')
  await call(`/capas/${done.id}/close`, { method: 'POST', token: manager, body: { note: 'Handled' } })

  const list = (await call('/capas', { token: manager })).body
  assert.deepEqual(
    list.map((c) => c.id),
    [soon.id, late.id, done.id]
  )
})

test('overdue is flagged on the way out', async () => {
  const { call, manager, unitA } = await withFinding()
  const capa = (
    await call('/capas', {
      method: 'POST',
      token: manager,
      body: { unit_id: unitA, title: 'Overdue thing', due_date: yesterday() },
    })
  ).body

  const list = (await call('/capas', { token: manager })).body
  assert.equal(list.find((c) => c.id === capa.id).overdue, true)

  const summary = (await call('/capas/summary', { token: manager })).body
  assert.equal(summary.open, 1)
  assert.equal(summary.overdue, 1)
})

test('mine means assigned to me, across every unit I work in', async () => {
  const { call, db, manager, unitA } = await withFinding()
  const managerId = (await db.get("SELECT id FROM users WHERE username = 'lhr.manager'")).id

  const mine = (
    await call('/capas', {
      method: 'POST',
      token: manager,
      body: { unit_id: unitA, title: 'Mine', owner_id: managerId },
    })
  ).body
  await call('/capas', { method: 'POST', token: manager, body: { unit_id: unitA, title: 'Somebody else' } })

  const list = (await call('/capas?mine=true', { token: manager })).body
  assert.deepEqual(list.map((c) => c.id), [mine.id])

  // The footgun this guards: z.coerce.boolean() reads "false" as true.
  const everything = (await call('/capas?mine=false', { token: manager })).body
  assert.equal(everything.length, 2)
})

/* ----------------------------------------------------------- the scoping -- */

test('another unit\'s actions are invisible, not just unlisted', async () => {
  const { call, db, manager, other, unitA } = await withFinding()
  const capa = (
    await call('/capas', { method: 'POST', token: manager, body: { unit_id: unitA, title: 'LHR only' } })
  ).body

  assert.deepEqual((await call('/capas', { token: other })).body, [])
  // 404 rather than 403: whether the action exists is itself not their business.
  assert.equal((await call(`/capas/${capa.id}`, { token: other })).status, 404)

  // Someone who holds capa.close in their own unit, which is the case that
  // distinguishes "you may not do this at all" from "not your unit": without
  // the permission the route refuses everyone identically and proves nothing.
  const { id: outsiderId } = await db.get("SELECT id FROM users WHERE username = 'dxb.inspector'")
  await db.run(
    "INSERT INTO user_permissions (user_id, permission, granted) VALUES (@u, 'capa.close', 1)",
    { u: outsiderId }
  )
  const reauthorised = await signIn(call, 'dxb.inspector', 'inspector-password')

  assert.equal(
    (
      await call(`/capas/${capa.id}/close`, {
        method: 'POST',
        token: reauthorised,
        body: { note: 'Not mine to close' },
      })
    ).status,
    404
  )
})

test('an inspector can raise an action but not close one', async () => {
  const { call, inspector, unitA } = await withFinding()

  const raised = await call('/capas', {
    method: 'POST',
    token: inspector,
    body: { unit_id: unitA, title: 'Spotted on the walk' },
  })
  assert.equal(raised.status, 201, 'raising is the whole point of walking the floor')

  const closed = await call(`/capas/${raised.body.id}/close`, {
    method: 'POST',
    token: inspector,
    body: { note: 'I say it is fine' },
  })
  // Finding it and signing it off should not be the same person's call.
  assert.equal(closed.status, 403)

  const assigned = await call(`/capas/${raised.body.id}`, {
    method: 'PATCH',
    token: inspector,
    body: { priority: 'high' },
  })
  assert.equal(assigned.status, 403)
})

test('work cannot be handed to somebody outside the tenant', async () => {
  const { call, db, manager, unitA } = await withFinding()
  const { id: outsiderTenant } = await db.insert(
    "INSERT INTO tenants (name, slug) VALUES ('Other Group', 'other')"
  )
  const { id: outsider } = await db.insert(
    `INSERT INTO users (tenant_id, username, role, password_hash) VALUES (@t, 'outsider', 'inspector', 'x')`,
    { t: outsiderTenant }
  )

  const res = await call('/capas', {
    method: 'POST',
    token: manager,
    body: { unit_id: unitA, title: 'Nope', owner_id: outsider },
  })
  assert.equal(res.status, 422)
})

test('signing in is required', async () => {
  const { call } = await withFinding()
  assert.equal((await call('/capas')).status, 401)
  assert.equal((await call('/capas/summary')).status, 401)
})
