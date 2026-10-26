/** Shared card, title, legend and table-view toggle for every chart. */
import { useState } from 'react'

export default function ChartFrame({ title, subtitle, legend, table, children, actions }) {
  const [showTable, setShowTable] = useState(false)

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <div>
          <h3 className="chart__title">{title}</h3>
          {subtitle && <p className="chart__subtitle">{subtitle}</p>}
        </div>
        <div className="chart__actions">
          {actions}
          {table && (
            <button
              type="button"
              className="chart__toggle"
              aria-pressed={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </figcaption>

      {/* A legend is always present for 2+ series, so identity is never colour alone. */}
      {legend && legend.length > 1 && (
        <ul className="legend">
          {legend.map((entry) => (
            <li key={entry.label}>
              <span
                className={`legend__swatch${entry.icon ? ' legend__swatch--status' : ''}`}
                style={{ background: entry.color }}
                aria-hidden="true"
              />
              {entry.icon && <span className="legend__icon" aria-hidden="true">{entry.icon}</span>}
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      {showTable && table ? <div className="chart__table-wrap">{table}</div> : children}
    </figure>
  )
}
