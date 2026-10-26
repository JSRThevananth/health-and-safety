import { useEffect, useState } from 'react'
import { api, apiDownload } from '../lib/api.js'

/**
 * Send the report for a submitted inspection.
 *
 * The unit's own recipients are listed with their defaults already ticked, so
 * the ordinary case is one tap. Ticking is per-send: someone can be left off
 * this report without being removed from the unit, and a visiting auditor can be
 * added for one report without ever being added to the list.
 *
 * Only this unit's recipients are offered, which is the point - the server
 * enforces it too, but an inspector should never be shown another unit's
 * addresses in the first place.
 */
export default function SendReport({ inspection, onClose }) {
  const [recipients, setRecipients] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [extra, setExtra] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)

  /**
   * The same document the recipients get, for whoever wants to file it now.
   * Worth having next to Send: the commonest reason to re-send a report is
   * that somebody only needed a copy for themselves.
   */
  const downloadPdf = async () => {
    setSending('pdf')
    setError('')
    try {
      await apiDownload(`/inspections/${inspection.id}/report.pdf`, `inspection-${inspection.id}.pdf`)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api(`/inspections/${inspection.id}/recipients`)
      .then((rows) => {
        if (cancelled) return
        setRecipients(rows)
        setSelected(new Set(rows.filter((r) => r.default_selected).map((r) => r.id)))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [inspection.id])

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const extraEmails = extra
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  const send = async () => {
    setSending('send')
    setError('')
    try {
      const result = await api(`/inspections/${inspection.id}/report`, {
        method: 'POST',
        body: { recipient_ids: [...selected], extra_emails: extraEmails },
      })
      setSent(result)
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setSending(false)
    }
  }

  const nobody = selected.size === 0 && extraEmails.length === 0

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Send inspection report">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Send report</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {sent ? (
          <Sent result={sent} onClose={onClose} />
        ) : (
          <>
            <p className="muted">
              {inspection.unit_name} · {inspection.summary_counts.exceptions} finding
              {inspection.summary_counts.exceptions === 1 ? '' : 's'} · the photos are fetched back
              out of storage and attached as the report is built.
            </p>

            {recipients === null ? (
              <p className="muted">Loading recipients…</p>
            ) : recipients.length === 0 ? (
              <p className="notice notice--warn">
                This unit has no report recipients yet. Add one under Units, or type an address below.
              </p>
            ) : (
              <fieldset className="recipients">
                <legend>Recipients for {inspection.unit_name}</legend>
                {recipients.map((recipient) => (
                  <label key={recipient.id} className="recipients__row">
                    <input
                      type="checkbox"
                      checked={selected.has(recipient.id)}
                      onChange={() => toggle(recipient.id)}
                    />
                    <span>
                      <b>{recipient.name || recipient.email}</b>
                      {recipient.name && <small> {recipient.email}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            <label className="field">
              <span>Also send to (optional)</span>
              <input
                type="text"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="auditor@example.com"
                autoComplete="off"
              />
              <small className="muted">Separate several with commas. Not saved to the unit.</small>
            </label>

            <p className="muted small">
              Recipients get the full report as a PDF, photographs and signatures
              included — so it can be filed without keeping the email.
            </p>

            {error && <p className="error" role="alert">{error}</p>}

            <footer className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--ghost" onClick={downloadPdf} disabled={Boolean(sending)}>
                {sending === 'pdf' ? 'Preparing…' : 'Download PDF'}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={send}
                disabled={Boolean(sending) || nobody}
              >
                {sending === 'send' ? 'Sending…' : `Send to ${selected.size + extraEmails.length}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function Sent({ result, onClose }) {
  const missing = result.photos?.unavailable ?? []

  return (
    <>
      <p className="notice notice--done">
        <strong>
          {result.status === 'sent' ? 'Report sent.' : `Report ${result.status}.`}
        </strong>
        <span>{result.recipients.join(', ')}</span>
      </p>

      {result.status === 'skipped' && (
        <p className="muted">
          Email is switched off on this deployment, so the report was recorded but not delivered.
        </p>
      )}

      {/*
        Named rather than counted. "3 of 4 photos attached" is the thing a
        quality manager needs to notice before forwarding this to a client.
      */}
      {missing.length > 0 && (
        <div className="notice notice--warn">
          <strong>{missing.length} photo{missing.length === 1 ? '' : 's'} not attached</strong>
          <ul>
            {missing.map((photo) => (
              <li key={photo.name}>
                {photo.name} — {photo.why}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="modal__foot">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </>
  )
}
