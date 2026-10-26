import { today } from '../db.js'
import { capaSummary } from './capas.js'

/**
 * The figures behind the dashboard.
 *
 * Everything here is derived, never stored. An inspection records only the
 * points an inspector actually touched - everything else is satisfactory by
 * definition - so a compliance score is the pinned template's size minus what
 * was flagged, not a column somebody has to remember to update.
 *
 * Six months, because that is where a trend becomes visible without the chart
 * turning into a smear. Everything is scoped to the units the caller can
 * reach, so two customers on one deployment never see each other's figures.
 */

const MONTHS = 6

/** The most units drawn as their own line before the rest fold into one. */
export const MAX_SERIES = 6

/** YYYY-MM for the month `back` months before now. */
export function monthsAgo(back, from = new Date()) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - back, 1))
  return date.toISOString().slice(0, 7)
}

export const monthLabel = (period) =>
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    Number(period.slice(5, 7)) - 1
  ]

/**
 * A compliance score for one inspection: the share of the checklist that was
 * not flagged.
 *
 * Null rather than 100 when the pinned template has no points at all - an
 * empty form scoring full marks would flatter a unit that has not been
 * inspected properly.
 */
export function complianceOf(points, exceptions) {
  if (!points) return null
  return Math.max(0, Math.round(((points - exceptions) / points) * 1000) / 10)
}

export async function dashboardKpis(db, { unitIds, now = new Date() }) {
  if (unitIds !== null && unitIds.length === 0) return empty()

  const scope = unitIds === null ? '' : `AND i.unit_id IN (${db.idList(unitIds)})`
  const since = `${monthsAgo(MONTHS - 1, now)}-01T00:00:00Z`
  const months = Array.from({ length: MONTHS }, (_, i) => monthsAgo(MONTHS - 1 - i, now))

  // One row per completed inspection, with what was flagged on it. Counted in
  // SQL rather than fetched and tallied here: a unit inspecting daily has a
  // few hundred of these over six months, and the Worker has 10 ms of CPU.
  const inspections = await db.all(
    `SELECT i.id, i.unit_id, i.template_id,
            u.name AS unit_name, u.code AS unit_code,
            substr(COALESCE(i.submitted_at, i.started_at), 1, 7) AS period,
            (SELECT COUNT(*) FROM inspection_items it
              WHERE it.inspection_id = i.id AND it.rating = 'critical') AS critical,
            (SELECT COUNT(*) FROM inspection_items it
              WHERE it.inspection_id = i.id AND it.rating = 'needs_improvement') AS needs
       FROM inspections i
       JOIN units u ON u.id = i.unit_id
      WHERE i.status IN ('submitted', 'signed')
        AND COALESCE(i.submitted_at, i.started_at) >= @since
        ${scope}
      ORDER BY i.id`,
    { since }
  )

  // How many points each pinned template actually asks about. Separate because
  // several inspections share one template, and joining a count onto every row
  // would recount it per inspection.
  const sizes = new Map(
    (
      await db.all(
        `SELECT template_id, COUNT(*) AS points
           FROM unit_template_items WHERE enabled = 1 GROUP BY template_id`
      )
    ).map((row) => [row.template_id, row.points])
  )

  const recurring = await db.all(
    `SELECT COALESCE(ti.text_override, li.text, ci.text) AS label, COUNT(*) AS value
       FROM inspection_items it
       JOIN inspections i ON i.id = it.inspection_id
       JOIN unit_template_items ti ON ti.id = it.template_item_id
       LEFT JOIN library_items li ON li.id = ti.library_item_id
       LEFT JOIN unit_custom_items ci ON ci.id = ti.custom_item_id
      WHERE it.rating IN ('critical', 'needs_improvement')
        AND i.status IN ('submitted', 'signed')
        AND COALESCE(i.submitted_at, i.started_at) >= @since
        ${scope}
      GROUP BY label
      HAVING label IS NOT NULL
      ORDER BY value DESC, label
      LIMIT 5`,
    { since }
  )

  const actions = await capaSummary(db, unitIds)

  /* ------------------------------------------------------------- shaping -- */

  const units = new Map()
  const byMonth = new Map(months.map((period) => [period, { critical: 0, needs: 0, inspections: 0 }]))

  for (const row of inspections) {
    const points = sizes.get(row.template_id) ?? 0
    const score = complianceOf(points, row.critical + row.needs)

    if (!units.has(row.unit_id)) {
      units.set(row.unit_id, { id: row.unit_id, name: row.unit_name, code: row.unit_code, months: new Map() })
    }
    const unit = units.get(row.unit_id)
    if (!unit.months.has(row.period)) unit.months.set(row.period, { scores: [], count: 0 })
    const bucket = unit.months.get(row.period)
    if (score !== null) bucket.scores.push(score)
    bucket.count += 1

    const month = byMonth.get(row.period)
    if (month) {
      month.critical += row.critical
      month.needs += row.needs
      month.inspections += 1
    }
  }

  const mean = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null)

  // Busiest units first, so a tenant with more than the chart can carry still
  // sees the ones being inspected rather than the first six by id.
  const ranked = [...units.values()].sort(
    (a, b) =>
      [...b.months.values()].reduce((n, m) => n + m.count, 0) -
      [...a.months.values()].reduce((n, m) => n + m.count, 0)
  )

  const compliance = ranked.slice(0, MAX_SERIES).map((unit) => ({
    name: unit.name,
    points: months.map((period) => ({
      label: monthLabel(period),
      value: mean(unit.months.get(period)?.scores || []),
    })),
  }))

  const thisMonth = months.at(-1)
  const lastMonth = months.at(-2)
  const scoreIn = (period) =>
    mean([...units.values()].flatMap((unit) => unit.months.get(period)?.scores || []))

  return {
    months: months.map(monthLabel),
    generated_at: today(),
    has_data: inspections.length > 0,
    totals: {
      inspections: byMonth.get(thisMonth)?.inspections ?? 0,
      inspections_last_month: byMonth.get(lastMonth)?.inspections ?? 0,
      critical: byMonth.get(thisMonth)?.critical ?? 0,
      critical_last_month: byMonth.get(lastMonth)?.critical ?? 0,
      compliance: scoreIn(thisMonth),
      compliance_last_month: scoreIn(lastMonth),
    },
    actions,
    compliance,
    // A unit with no inspection this month has no score this month; it is left
    // out of the ranking rather than shown as zero, which would read as a unit
    // failing everything rather than one nobody has visited.
    ranking: ranked
      .map((unit) => ({ label: unit.name, value: mean(unit.months.get(thisMonth)?.scores || []) }))
      .filter((row) => row.value !== null)
      .sort((a, b) => b.value - a.value),
    severity: months.map((period) => ({
      label: monthLabel(period),
      values: { critical: byMonth.get(period).critical, needs: byMonth.get(period).needs },
    })),
    recurring,
  }
}

function empty() {
  const months = Array.from({ length: MONTHS }, (_, i) => monthsAgo(MONTHS - 1 - i))
  return {
    months: months.map(monthLabel),
    generated_at: today(),
    has_data: false,
    totals: {
      inspections: 0,
      inspections_last_month: 0,
      critical: 0,
      critical_last_month: 0,
      compliance: null,
      compliance_last_month: null,
    },
    actions: { open: 0, overdue: 0, due_soon: 0, high: 0 },
    compliance: [],
    ranking: [],
    severity: months.map((period) => ({ label: monthLabel(period), values: { critical: 0, needs: 0 } })),
    recurring: [],
  }
}
