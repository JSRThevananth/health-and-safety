import ChartFrame from './ChartFrame.jsx'

/**
 * Ranked horizontal bars - the unit league table and the recurring-findings list.
 * Horizontal because the labels are long text; every bar is directly labelled, so
 * no legend or axis is needed for a single series.
 */
export default function RankedBarChart({ title, subtitle, rows, unit = '', color = 'var(--series-1)' }) {
  const max = Math.max(...rows.map((r) => r.value), 1)

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      table={
        <table className="data-table">
          <thead><tr><th>Item</th><th>Value</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td>{r.value}{unit}</td></tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ul className="ranked">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="ranked__label" title={row.label}>{row.label}</span>
            <span className="ranked__track">
              <span
                className="ranked__fill"
                style={{ width: `${(row.value / max) * 100}%`, background: row.color || color }}
              />
            </span>
            <span className="ranked__value">{row.value}{unit}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}
