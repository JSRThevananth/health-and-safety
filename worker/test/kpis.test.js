import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'
import { complianceOf, dashboardKpis, monthLabel, monthsAgo } from '../src/services/kpis.js'

/**
 * The dashboard's figures.
 *
 * These had been placeholder constants since before inspections existed, which
 * is a worse failure than an empty chart: a page of plausible numbers invites
 * decisions. So the tests here are mostly about the arithmetic being the real
 * arithmetic, and about an empty deployment saying it is empty.
 */

async function withInspections() {
  const h = await createHarness()
  const fixture = await seedFixture(h.db)
  const inspector = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const other = await signIn(h.call, 'dxb.inspector', 'inspector-password')

  /** Complete an inspection, flagging `flags` of its points. */
  const inspect = async (token, unitId, flags = []) => {
    const draft = (await h.call('/inspections/draft', { method: 'POST', token, body: { unit_id: unitId } })).body
    if (flags.length) {
      await h.call(`/inspections/${draft.id}`, {
        method: 'PATCH',
        token,
        body: {
          items: draft.sections[0].items.slice(0, flags.length).map((item, i) => ({
            template_item_id: item.id,
            rating: flags[i],
            note: `finding ${i}`,
          })),
        },
      })
    }
    await signInspection(h.call, token, draft.id)
    await h.call(`/inspections/${draft.id}/submit`, { method: 'POST', token })
    return draft
  }

  return { ...h, ...fixture, inspector, other, inspect }
}

/* ------------------------------------------------------------ arithmetic -- */

test('compliance is the share of the checklist that was not flagged', () => {
  assert.equal(complianceOf(100, 0), 100)
  assert.equal(complianceOf(100, 5), 95)
  assert.equal(complianceOf(303, 2), 99.3)
  // An empty form scoring full marks would flatter a unit nobody has inspected
  // properly, so it scores nothing at all.
  assert.equal(complianceOf(0, 0), null)
  // And a form flagged beyond its own size never goes negative.
  assert.equal(complianceOf(10, 50), 0)
})

test('the month window walks back correctly across a year boundary', () => {
  const jan = new Date(Date.UTC(2026, 0, 15))
  assert.equal(monthsAgo(0, jan), '2026-01')
  assert.equal(monthsAgo(1, jan), '2025-12')
  assert.equal(monthsAgo(5, jan), '2025-08')
  assert.equal(monthLabel('2026-01'), 'Jan')
  assert.equal(monthLabel('2025-12'), 'Dec')
})

/* ---------------------------------------------------------- the figures -- */

test('an untouched deployment says it has no data rather than showing zeros as fact', async () => {
  const { db } = await withInspections()

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.has_data, false)
  assert.equal(kpis.totals.compliance, null, 'no score, rather than 0% or 100%')
  assert.deepEqual(kpis.compliance, [])
  assert.deepEqual(kpis.ranking, [])
  assert.equal(kpis.months.length, 6)
})

test('a completed inspection moves every figure it should', async () => {
  const { db, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, ['critical', 'needs_improvement'])

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.has_data, true)
  assert.equal(kpis.totals.inspections, 1)
  assert.equal(kpis.totals.critical, 1)
  // 303 points, two flagged.
  assert.equal(kpis.totals.compliance, 99.3)

  const thisMonth = kpis.severity.at(-1)
  assert.deepEqual(thisMonth.values, { critical: 1, needs: 1 })
  assert.equal(kpis.ranking[0].label, 'Heathrow Catering Unit')
  assert.equal(kpis.ranking[0].value, 99.3)
  assert.equal(kpis.compliance[0].points.at(-1).value, 99.3)
})

test('two inspections in a month average rather than accumulate', async () => {
  const { db, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, ['critical', 'critical', 'critical'])
  await inspect(inspector, unitA, [])

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.totals.inspections, 2)
  // (99.0 + 100) / 2 - a clean visit has to be able to pull a score up, or the
  // number is a running tally of bad news rather than a score.
  assert.equal(kpis.totals.compliance, 99.5)
  assert.equal(kpis.severity.at(-1).values.critical, 3)
})

test('a draft counts for nothing until it is submitted', async () => {
  const { db, call, inspector, unitA } = await withInspections()
  await call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: unitA } })

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.has_data, false)
  assert.equal(kpis.totals.inspections, 0)
})

test('the recurring list names the finding, most frequent first', async () => {
  const { db, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, ['critical', 'needs_improvement'])
  await inspect(inspector, unitA, ['critical'])

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.recurring[0].value, 2, 'the first point was flagged on both visits')
  assert.ok(kpis.recurring[0].label.length > 3, 'and it is named, not numbered')
  assert.equal(kpis.recurring[1].value, 1)
})

/* ------------------------------------------------------------- scoping -- */

test('a manager sees their own unit and not the other', async () => {
  const { db, inspect, inspector, other, unitA, unitB } = await withInspections()
  await inspect(inspector, unitA, ['critical'])
  await inspect(other, unitB, ['critical', 'critical', 'critical', 'critical'])

  const everything = await dashboardKpis(db, { unitIds: null })
  assert.equal(everything.totals.inspections, 2)
  assert.equal(everything.ranking.length, 2)

  const justA = await dashboardKpis(db, { unitIds: [unitA] })
  assert.equal(justA.totals.inspections, 1)
  assert.deepEqual(justA.ranking.map((r) => r.label), ['Heathrow Catering Unit'])
  assert.equal(justA.totals.critical, 1, "not the other unit's four")
})

test('somebody with no units sees nothing rather than everything', async () => {
  const { db, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, ['critical'])

  // The failure mode of a scoping bug should be seeing too little.
  const kpis = await dashboardKpis(db, { unitIds: [] })
  assert.equal(kpis.has_data, false)
  assert.equal(kpis.totals.inspections, 0)
})

test('a unit nobody visited this month is left out of the ranking, not scored zero', async () => {
  const { db, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, [])

  const kpis = await dashboardKpis(db, { unitIds: null })
  // Dubai exists and has a published checklist, but no inspection: a zero would
  // read as a unit failing everything rather than one nobody has been to.
  assert.deepEqual(kpis.ranking.map((r) => r.label), ['Heathrow Catering Unit'])
})

/* ------------------------------------------------------- open actions -- */

test('the open and overdue counts come through', async () => {
  const { db, call, unitA } = await withInspections()
  const manager = await signIn(call, 'lhr.manager', 'manager-password')
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  await call('/capas', {
    method: 'POST',
    token: manager,
    body: { unit_id: unitA, title: 'Overdue thing', due_date: yesterday },
  })

  const kpis = await dashboardKpis(db, { unitIds: null })
  assert.equal(kpis.actions.open, 1)
  assert.equal(kpis.actions.overdue, 1)
})

/* --------------------------------------------------------------- route -- */

test('the dashboard fetches it in one request', async () => {
  const { call, inspect, inspector, unitA } = await withInspections()
  await inspect(inspector, unitA, ['critical'])
  const token = await signIn(call, 'omni', 'admin-password')

  const res = await call('/kpis', { token })
  assert.equal(res.status, 200)
  assert.equal(res.body.has_data, true)
  assert.equal(res.body.months.length, 6)
  assert.ok(res.body.actions)
  assert.ok(res.body.compliance[0].points.length === 6)
})

test('signing in is required', async () => {
  const { call } = await withInspections()
  assert.equal((await call('/kpis')).status, 401)
})
