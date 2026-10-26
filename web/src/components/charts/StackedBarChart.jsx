import { useState } from 'react'
import { useChartWidth } from './useChartWidth.js'
import ChartFrame from './ChartFrame.jsx'

const PAD = { top: 16, right: 12, bottom: 28, left: 32 }

/**
 * Findings by severity per period.
 *
 * Severity is a status scale, not a series scale, so it uses the reserved status
 * colours - which is exactly why each legend entry carries an icon and a label:
 * status green and red are not CVD-separable, so colour never carries it alone.
 * Segments are separated by a 2px surface gap.
 */
export default function StackedBarChart({ title, subtitle, categories, data }) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState(null)

  const height = width < 520 ? 200 : 240
  const innerW = Math.max(width - PAD.left - PAD.right, 10)
  const innerH = height - PAD.top - PAD.bottom

  const totals = data.map((d) => categories.reduce((sum, c) => sum + (d.values[c.key] || 0), 0))
  const max = Math.max(...totals, 1)
  const niceMax = Math.ceil(max / 4) * 4 || 4

  const slot = innerW / data.length
  const barW = Math.min(slot * 0.62, 44)
  const y = (v) => PAD.top + innerH - (v / niceMax) * innerH
  const step = Math.ceil(data.length / (width < 480 ? 4 : 8))

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={categories.map((c) => ({ label: c.label, color: c.color, icon: c.icon }))}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              {categories.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                {categories.map((c) => <td key={c.key}>{d.values[c.key] || 0}</td>)}
                <td>{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart__plot" ref={ref}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. ${data.map((d, i) => `${d.label}: ${totals[i]} findings`).join('. ')}`}
        >
          {[0, niceMax / 2, niceMax].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">{t}</text>
            </g>
          ))}

          {data.map((d, i) => {
            const cx = PAD.left + slot * i + slot / 2
            let cursor = 0
            return (
              <g
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {/* Hit target wider than the bar itself. */}
                <rect x={cx - slot / 2} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                {categories.map((c) => {
                  const value = d.values[c.key] || 0
                  if (!value) return null
                  const h = (value / niceMax) * innerH
                  const yTop = y(cursor + value)
                  cursor += value
                  return (
                    <rect
                      key={c.key}
                      x={cx - barW / 2}
                      y={yTop}
                      width={barW}
                      height={Math.max(h - 2, 1)}
                      rx="3"
                      fill={c.color}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )
                })}
                {(i % step === 0 || i === data.length - 1) && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="chart__tick">{d.label}</text>
                )}
              </g>
            )
          })}
        </svg>

        {hover !== null && (
          <div
            className="tooltip"
            style={{ left: `${((PAD.left + slot * hover + slot / 2) / width) * 100}%`, top: 0 }}
            role="status"
          >
            <strong>{data[hover].label}</strong>
            {categories.map((c) => (
              <span key={c.key}>
                <i style={{ background: c.color }} aria-hidden="true" />
                {c.label}
                <b>{data[hover].values[c.key] || 0}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  )
}
