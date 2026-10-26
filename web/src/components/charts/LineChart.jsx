import { useState } from 'react'
import { useChartWidth } from './useChartWidth.js'
import ChartFrame from './ChartFrame.jsx'

const PAD = { top: 16, right: 16, bottom: 28, left: 36 }

/**
 * Compliance score over time, one line per unit.
 * Change-over-time is the job, so a line is the right form. A crosshair and
 * tooltip ship by default; the last point of each series is directly labelled
 * so identity never rests on colour alone.
 */
export default function LineChart({ title, subtitle, series, yLabel = '%', domain }) {
  const [ref, width] = useChartWidth()
  const [hover, setHover] = useState(null)

  const height = width < 520 ? 200 : 240
  const innerW = Math.max(width - PAD.left - PAD.right, 10)
  const innerH = height - PAD.top - PAD.bottom
  const labels = series[0]?.points.map((p) => p.label) ?? []

  /*
   * Fit the axis to the data rather than pinning it to 0-100. These scores cluster in
   * the high range, where a zero-based axis flattens every line into one indistinct
   * band and hides the trend the chart exists to show. Lines carry no filled area, so
   * they do not require a zero baseline the way bars do - and the tick labels state
   * the range plainly, so nothing is overstated.
   */
  const values = series.flatMap((s) => s.points.map((p) => p.value))
  const [min, max] = domain ?? [
    Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10),
    Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10),
  ]

  const x = (i) => PAD.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW)
  const y = (v) => PAD.top + innerH - ((v - min) / (max - min)) * innerH

  const ticks = [min, Math.round((min + max) / 2), max]
  // Thin out x labels on narrow screens so they never collide.
  const step = Math.ceil(labels.length / (width < 480 ? 4 : 8))

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left
    const i = Math.round(((px - PAD.left) / innerW) * (labels.length - 1))
    setHover(i >= 0 && i < labels.length ? i : null)
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={series.map((s) => ({ label: s.name, color: s.color }))}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              {series.map((s) => <th key={s.name}>{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={label}>
                <td>{label}</td>
                {series.map((s) => <td key={s.name}>{s.points[i]?.value ?? '—'}{yLabel}</td>)}
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
          aria-label={`${title}. ${series.map((s) => `${s.name} ends at ${s.points.at(-1)?.value}${yLabel}`).join('. ')}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="chart__tick">{t}</text>
            </g>
          ))}

          {labels.map((label, i) =>
            i % step === 0 || i === labels.length - 1 ? (
              <text key={label} x={x(i)} y={height - 8} textAnchor="middle" className="chart__tick">{label}</text>
            ) : null
          )}

          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--axis)" strokeWidth="1" strokeDasharray="3 3" />
          )}

          {series.map((s) => (
            <polyline
              key={s.name}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
            />
          ))}

          {/* A 2px surface ring keeps overlapping markers legible. */}
          {hover !== null &&
            series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.points[hover].value)} r="4.5"
                fill={s.color} stroke="var(--surface)" strokeWidth="2" />
            ))}

          {series.map((s) => (
            <circle key={`end-${s.name}`} cx={x(labels.length - 1)} cy={y(s.points.at(-1).value)} r="4"
              fill={s.color} stroke="var(--surface)" strokeWidth="2" />
          ))}
        </svg>

        {hover !== null && (
          <div
            className="tooltip"
            style={{ left: `${(x(hover) / width) * 100}%`, top: 0 }}
            role="status"
          >
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} aria-hidden="true" />
                {s.name}
                <b>{s.points[hover].value}{yLabel}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  )
}
