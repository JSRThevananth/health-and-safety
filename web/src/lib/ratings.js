/**
 * Inspection ratings.
 *
 * These are status values, not chart series. Status colours are reserved and are
 * deliberately not colourblind-separable from one another, so every rating carries
 * an icon and a label and is never distinguished by colour alone.
 */
export const RATINGS = [
  { key: 'satisfactory', label: 'Satisfactory', short: 'OK', icon: '✓', color: 'var(--status-good)' },
  { key: 'needs_improvement', label: 'Needs improvement', short: 'Improve', icon: '●', color: 'var(--status-warning)' },
  { key: 'critical', label: 'Critical', short: 'Critical', icon: '▲', color: 'var(--status-critical)' },
  { key: 'na', label: 'Not applicable', short: 'N/A', icon: '–', color: 'var(--ink-muted)' },
]

export const DEFAULT_RATING = 'satisfactory'

export const ratingOf = (key) => RATINGS.find((r) => r.key === key) ?? RATINGS[0]

/** Ratings that require follow-up evidence and become corrective actions. */
export const isException = (key) => key === 'needs_improvement' || key === 'critical'
