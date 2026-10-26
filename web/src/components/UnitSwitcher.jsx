import { useUnit } from '../lib/unitContext.jsx'

/**
 * Scope selector. Only units the account already has are listed; "All units" appears
 * for an omni admin alone. A single-unit user gets a static label, not a control.
 */
export default function UnitSwitcher() {
  const { units, unitId, canSelectAll, select, loading } = useUnit()

  if (loading) return null

  if (units.length === 0) {
    return <span className="unit-switcher unit-switcher--static muted">No unit assigned</span>
  }

  if (units.length === 1 && !canSelectAll) {
    return (
      <span className="unit-switcher unit-switcher--static">
        <UnitIcon />
        {units[0].name}
      </span>
    )
  }

  return (
    <label className="unit-switcher">
      <UnitIcon />
      <span className="sr-only">Unit</span>
      <select
        value={unitId === null ? 'all' : String(unitId)}
        onChange={(e) => select(e.target.value === 'all' ? null : Number(e.target.value))}
      >
        {canSelectAll && <option value="all">All units</option>}
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.name}</option>
        ))}
      </select>
    </label>
  )
}

function UnitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M10 21v-5h4v5" />
    </svg>
  )
}
