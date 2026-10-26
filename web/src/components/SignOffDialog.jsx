import { useState } from 'react'
import { api } from '../lib/api.js'
import SignaturePad from './SignaturePad.jsx'

/**
 * Sign and submit.
 *
 * The inspector signs here, then the inspection is submitted - in that order,
 * and in one step so neither can be skipped. A signature on a record that can
 * still be edited afterwards means nothing, and a record frozen before anyone
 * signed it cannot be signed at all.
 *
 * The department supervisor's countersignature is optional and taken on the
 * same device, because the end of the walkround is the one moment both people
 * are standing in the same place. An inspector working a night shift with
 * nobody to countersign is not blocked by it.
 */
export default function SignOffDialog({ inspection, onDone, onClose }) {
  const [inspectorName, setInspectorName] = useState(inspection.inspector_name || '')
  const [inspectorInk, setInspectorInk] = useState('')
  const [wantSupervisor, setWantSupervisor] = useState(false)
  const [supervisorName, setSupervisorName] = useState('')
  const [supervisorInk, setSupervisorInk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const counts = inspection.summary_counts
  const ready =
    inspectorName.trim().length >= 2 &&
    inspectorInk &&
    (!wantSupervisor || (supervisorName.trim().length >= 2 && supervisorInk))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/inspections/${inspection.id}/signature`, {
        method: 'POST',
        body: { role: 'inspector', name: inspectorName.trim(), image: inspectorInk },
      })
      if (wantSupervisor) {
        await api(`/inspections/${inspection.id}/signature`, {
          method: 'POST',
          body: { role: 'supervisor', name: supervisorName.trim(), image: supervisorInk },
        })
      }
      const done = await api(`/inspections/${inspection.id}/submit`, { method: 'POST' })
      onDone(done)
    } catch (err) {
      // The server refuses a submission whose findings are not described, and
      // names them. That is the most common failure here, so show it verbatim.
      setError(err.payload?.error || err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Sign and submit inspection">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Sign and submit</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="muted">
          {counts.exceptions} finding{counts.exceptions === 1 ? '' : 's'} ·{' '}
          {counts.untouched} of {counts.total} points accepted at the default rating.
          Once submitted this inspection cannot be changed.
        </p>

        <label className="field">
          <span>Inspector</span>
          <input
            type="text"
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            autoComplete="name"
          />
        </label>
        <SignaturePad onChange={setInspectorInk} disabled={busy} />

        <label className="checkline">
          <input
            type="checkbox"
            checked={wantSupervisor}
            onChange={(e) => setWantSupervisor(e.target.checked)}
          />
          <span>The department supervisor is here to countersign</span>
        </label>

        {wantSupervisor && (
          <>
            <label className="field">
              <span>Department supervisor</span>
              <input
                type="text"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                placeholder="Their full name"
                autoComplete="off"
              />
            </label>
            <SignaturePad onChange={setSupervisorInk} disabled={busy} />
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={busy || !ready}>
            {busy ? 'Submitting…' : 'Sign and submit'}
          </button>
        </footer>
      </div>
    </div>
  )
}
