import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import StatTile from '../components/charts/StatTile.jsx'
import LineChart from '../components/charts/LineChart.jsx'
import StackedBarChart from '../components/charts/StackedBarChart.jsx'
import RankedBarChart from '../components/charts/RankedBarChart.jsx'

/**
 * The overview.
 *
 * Every figure comes from /api/kpis, scoped to the units the caller can reach.
 * It showed convincing invented numbers for a long time, which is worse than
 * showing nothing: a page of plausible figures invites decisions. Until a unit
 * has a completed inspection it now says so plainly instead.
 */

const SEVERITY_CATEGORIES = [
  // Status colours are reserved and are never CVD-separable from one another,
  // so every entry carries an icon and a label as well.
  { key: 'critical', label: 'Critical', color: 'var(--status-critical)', icon: '▲' },
  { key: 'needs', label: 'Needs improvement', color: 'var(--status-warning)', icon: '●' },
]

const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

export default function DashboardPage() {
  const { user } = useAuth()
  const [kpis, setKpis] = useState(null)
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api('/kpis').then(setKpis).catch((err) => setError(err.message))
    api('/units').then(setUnits).catch(() => setUnits([]))
  }, [])

  const complianceSeries = useMemo(
    () =>
      (kpis?.compliance || []).map((unit, i) => ({
        name: unit.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        // A month with no inspection has no score; dropping the point leaves a
        // gap in the line rather than a drop to zero, which would read as a
        // catastrophic month instead of a quiet one.
        points: unit.points.filter((p) => p.value !== null),
      })),
    [kpis]
  )

  const totals = kpis?.totals

  /*
   * A trend needs something to trend from. With no inspection last month, "3
   * inspections, up 3" and "2 critical findings, worsened by 2" are arrows
   * pointing at nothing - and on a new deployment that is every tile, which
   * teaches people to ignore the arrows on the tiles that do mean something.
   */
  const comparable = totals?.inspections_last_month > 0
  const delta = (now, before) =>
    !comparable || now === null || before === null || before === undefined
      ? undefined
      : Math.round((now - before) * 10) / 10
  const versus = comparable ? 'vs last month' : 'no inspections last month'

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>{user.unit_ids === null ? 'Group overview' : 'Overview'}</h1>
          <p className="muted">
            {user.unit_ids === null
              ? `All units · ${units.length} active`
              : `${units.length} assigned unit${units.length === 1 ? '' : 's'}`}
            {kpis?.generated_at && ` · as at ${kpis.generated_at}`}
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {!kpis ? (
        <p className="muted">Loading…</p>
      ) : !kpis.has_data ? (
        <div className="empty glass">
          <span className="empty__badge">Nothing to show yet</span>
          <p>
            No completed inspections in the last six months, so there is nothing to score.
            Figures appear here as soon as one is submitted.
          </p>
          <Link className="btn btn--primary btn--sm" to="/app/inspections">
            Start an inspection
          </Link>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <StatTile
              label="Compliance this month"
              value={totals.compliance ?? '—'}
              unit={totals.compliance === null ? '' : '%'}
              delta={delta(totals.compliance, totals.compliance_last_month)}
              caption={versus}
            />
            <StatTile
              label="Inspections this month"
              value={totals.inspections}
              delta={delta(totals.inspections, totals.inspections_last_month)}
              caption={versus}
            />
            <StatTile
              label="Critical findings"
              value={totals.critical}
              // Fewer is better, so the arrow's colour has to be told which way
              // round good is.
              delta={delta(totals.critical, totals.critical_last_month)}
              deltaGood={totals.critical <= totals.critical_last_month}
              status={totals.critical > 0 ? 'critical' : undefined}
              caption="this month"
            />
            <StatTile
              label="Open corrective actions"
              value={kpis.actions.open}
              status={kpis.actions.overdue > 0 ? 'warning' : undefined}
              caption={
                kpis.actions.overdue > 0
                  ? `${kpis.actions.overdue} overdue`
                  : kpis.actions.due_soon > 0
                    ? `${kpis.actions.due_soon} due this week`
                    : 'none overdue'
              }
            />
          </div>

          <div className="chart-grid">
            <LineChart
              title="Compliance score by unit"
              subtitle="Share of checklist points not flagged, by month"
              series={complianceSeries}
            />
            <StackedBarChart
              title="Findings by severity"
              subtitle="Raised per month across your units"
              categories={SEVERITY_CATEGORIES}
              data={kpis.severity}
            />
            <RankedBarChart
              title="Unit ranking"
              subtitle="Compliance score this month"
              rows={kpis.ranking}
              unit="%"
            />
            <RankedBarChart
              title="Most recurring findings"
              subtitle="Same point flagged across inspections"
              rows={kpis.recurring}
              color="var(--status-serious)"
            />
          </div>

          <p className="muted small dash__note">
            Compliance is the share of a unit's checklist that was not flagged, averaged over
            the inspections completed in that month. A month with no inspection has no score,
            so the line breaks rather than dropping to zero.
          </p>
        </>
      )}
    </div>
  )
}
