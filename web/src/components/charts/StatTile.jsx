/**
 * A single headline number. Not a chart - per the form heuristic, one value with
 * a trend is a stat tile, and drawing it as a chart would add noise, not meaning.
 * The delta carries an arrow glyph as well as colour.
 */
export default function StatTile({ label, value, unit = '', delta, deltaGood, caption, status }) {
  const hasDelta = delta !== undefined && delta !== null
  const rising = hasDelta && delta > 0
  const good = hasDelta && (deltaGood === undefined ? rising : deltaGood)

  return (
    <div className={`stat${status ? ` stat--${status}` : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </span>
      <span className="stat__foot">
        {hasDelta && (
          <span className={`stat__delta ${good ? 'is-good' : 'is-bad'}`}>
            <span aria-hidden="true">{rising ? '▲' : '▼'}</span>
            {Math.abs(delta)}{unit} <span className="sr-only">{good ? 'improved' : 'worsened'}</span>
          </span>
        )}
        {caption && <span className="stat__caption">{caption}</span>}
      </span>
    </div>
  )
}
