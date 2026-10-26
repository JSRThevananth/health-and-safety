import { useMemo, useState } from 'react'
import { api } from '../lib/api.js'

/**
 * Turn this inspection's findings into corrective actions.
 *
 * Offered at sign-off because that is the one moment somebody is looking at
 * the whole list of what was wrong. Asking them to retype each finding into a
 * separate form later is how a corrective action log ends up empty.
 *
 * Everything is ticked to begin with: the inspector already decided these were
 * problems when they rated them, so the question here is which ones do *not*
 * need an action, not which ones do.
 */
export default function RaiseActions({ inspection, onClose, onRaised }) {
  const findings = useMemo(
    () =>
      (inspection.sections || [])
        .flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })))
        .filter((item) => item.rating !== 'satisfactory' && item.rating !== 'na'),
    [inspection]
  )

  const [chosen, setChosen] = useState(() => new Set(findings.map((f) => f.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const toggle = (id) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const raise = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(
        await api(`/capas/from-inspection/${inspection.id}`, {
          method: 'POST',
          body: { template_item_ids: [...chosen] },
        })
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Raise corrective actions">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Raise corrective actions</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {result ? (
          <>
            <p>
              <b>{result.created}</b> action{result.created === 1 ? '' : 's'} raised.
              {result.skipped > 0 && ` ${result.skipped} already had one.`}
            </p>
            <p className="muted small">
              They are unassigned and due by priority — three days for a critical finding, a
              fortnight otherwise. Set owners under Corrective actions.
            </p>
            <footer className="modal__foot">
              <button type="button" className="btn btn--primary" onClick={onRaised}>
                Done
              </button>
            </footer>
          </>
        ) : findings.length === 0 ? (
          <>
            <p className="muted">Nothing was flagged on this inspection, so there is nothing to action.</p>
            <footer className="modal__foot">
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Close
              </button>
            </footer>
          </>
        ) : (
          <>
            <p className="muted small">
              Each one becomes an action carrying its wording and your note. A finding that
              already has an action is skipped.
            </p>

            <fieldset className="recipients findingpick">
              <legend className="sr-only">Findings to raise an action for</legend>
              {findings.map((finding) => (
                <label key={finding.id} className="recipients__row">
                  <input type="checkbox" checked={chosen.has(finding.id)} onChange={() => toggle(finding.id)} />
                  <span>
                    <b>{finding.text}</b>
                    <small>
                      {finding.section}
                      {finding.rating === 'critical' ? ' · critical, due in 3 days' : ' · due in a fortnight'}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>

            {error && <p className="error" role="alert">{error}</p>}

            <footer className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
                Not now
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={raise}
                disabled={busy || chosen.size === 0}
              >
                {busy ? 'Raising…' : `Raise ${chosen.size}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
