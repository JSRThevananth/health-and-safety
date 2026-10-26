import { useEffect, useState } from 'react'
import { api, apiDownload } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

/**
 * Units, and who receives each unit's reports.
 *
 * The two live on one screen because they are one job: a unit that exists but
 * has nobody to send its reports to is half set up, and the easiest way to make
 * that visible is to show the recipients next to the unit rather than behind
 * another click.
 */
export default function UnitsPage() {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const canManageUnits = user.permissions.includes('unit.manage')

  const load = async () => {
    setLoading(true)
    try {
      setUnits(await api('/units'))
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <div className="dash"><p className="muted">Loading units…</p></div>

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>Units</h1>
          <p className="muted">
            Each unit keeps its own checklist and its own report recipients.
            One unit's report never reaches another unit's list.
          </p>
        </div>
        {canManageUnits && (
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            Add unit
          </button>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      {units.length === 0 ? (
        <div className="empty glass">
          <span className="empty__badge">Nothing yet</span>
          <p>No units you can see. An admin can add one.</p>
        </div>
      ) : (
        <div className="unitlist">
          {units.map((unit) => (
            <UnitCard key={unit.id} unit={unit} canManageUnits={canManageUnits} user={user} />
          ))}
        </div>
      )}

      {adding && <AddUnit onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load() }} />}
    </div>
  )
}

function UnitCard({ unit, canManageUnits, user }) {
  const [recipients, setRecipients] = useState(null)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const canManageRecipients = user.permissions.includes('recipient.manage')

  const load = async () => {
    try {
      setRecipients(await api(`/units/${unit.id}/recipients`))
    } catch (err) {
      setError(err.message)
      setRecipients([])
    }
  }

  useEffect(() => {
    load()
  }, [unit.id])

  const add = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/units/${unit.id}/recipients`, {
        method: 'POST',
        body: { email: email.trim(), name: name.trim() },
      })
      setEmail('')
      setName('')
      await load()
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (recipient) => {
    if (!window.confirm(`Stop sending ${unit.code} reports to ${recipient.email}?`)) return
    try {
      await api(`/units/${unit.id}/recipients/${recipient.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err.payload?.error || err.message)
    }
  }

  const toggleDefault = async (recipient) => {
    try {
      await api(`/units/${unit.id}/recipients/${recipient.id}`, {
        method: 'PATCH',
        body: { default_selected: !recipient.default_selected },
      })
      await load()
    } catch (err) {
      setError(err.payload?.error || err.message)
    }
  }

  return (
    <section className="unitcard glass">
      <header className="unitcard__head">
        <div>
          <h2>
            {unit.name} <span className="unitcard__code">{unit.code}</span>
          </h2>
          {unit.location && <p className="muted small">{unit.location}</p>}
        </div>
      </header>

      <h3 className="unitcard__sub">Report recipients</h3>

      {recipients === null ? (
        <p className="muted small">Loading…</p>
      ) : recipients.length === 0 ? (
        <p className="muted small">
          Nobody yet. Reports for this unit have nowhere to go until somebody is added.
        </p>
      ) : (
        <ul className="reciplist">
          {recipients.map((recipient) => (
            <li key={recipient.id}>
              <span className="reciplist__who">
                <b>{recipient.name || recipient.email}</b>
                {recipient.name && <small>{recipient.email}</small>}
              </span>

              {canManageRecipients ? (
                <>
                  {/*
                    "Pre-ticked" rather than "always sent": the send dialog
                    starts from these, and the sender can still change their
                    mind for one report.
                  */}
                  <label className="reciplist__default" title="Pre-ticked when sending a report">
                    <input
                      type="checkbox"
                      checked={Boolean(recipient.default_selected)}
                      onChange={() => toggleDefault(recipient)}
                    />
                    <span>Default</span>
                  </label>
                  <button type="button" className="linkish reciplist__remove" onClick={() => remove(recipient)}>
                    Remove
                  </button>
                </>
              ) : (
                recipient.default_selected && <span className="muted small">Default</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManageRecipients && (
        <form className="recipadd" onSubmit={add}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            required
            aria-label={`Email address to add to ${unit.name}`}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Their name (optional)"
            aria-label={`Name for the new ${unit.name} recipient`}
          />
          <button type="submit" className="btn btn--ghost btn--sm" disabled={busy || !email.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      <MonthlyRecord unit={unit} canExport={user.permissions.includes('report.export')} />

      {error && <p className="error">{error}</p>}
      {!canManageUnits && !canManageRecipients && (
        <p className="muted small">You can see this unit but not change it.</p>
      )}
    </section>
  )
}

/**
 * The month's inspections as a spreadsheet.
 *
 * The sheet in Drive is rebuilt every night from the database, so this screen
 * mostly just points at it. The two buttons are for the times that is not
 * enough: a download when somebody wants the figures now without opening Drive,
 * and a rebuild when an inspection was submitted since last night's run.
 */
function MonthlyRecord({ unit, canExport }) {
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setSheet(null)
    api(`/units/${unit.id}/exports/monthly-sheet?period=${period}`)
      .then((data) => current && setSheet(data))
      .catch(() => current && setSheet({ built: false }))
    return () => {
      current = false
    }
  }, [unit.id, period])

  const download = async () => {
    setBusy('download')
    setError('')
    try {
      await apiDownload(
        `/units/${unit.id}/exports/monthly.csv?period=${period}`,
        `${unit.code}-inspections-${period}.csv`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const rebuild = async () => {
    setBusy('rebuild')
    setError('')
    try {
      const result = await api(`/units/${unit.id}/exports/monthly-sheet`, {
        method: 'POST',
        body: { period },
      })
      setSheet({ built: true, web_view_link: result.link, row_count: result.rows, built_at: new Date().toISOString() })
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <h3 className="unitcard__sub">Monthly record</h3>
      <div className="monthrec">
        <label className="monthrec__period">
          <span className="muted small">Month</span>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label={`Month of ${unit.name} inspections to export`}
          />
        </label>

        <div className="monthrec__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={download} disabled={Boolean(busy)}>
            {busy === 'download' ? 'Preparing…' : 'Download spreadsheet'}
          </button>
          {canExport && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={rebuild} disabled={Boolean(busy)}>
              {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild in Drive'}
            </button>
          )}
        </div>
      </div>

      {sheet?.built && sheet.web_view_link ? (
        <p className="muted small">
          <a href={sheet.web_view_link} target="_blank" rel="noreferrer">
            Open this month's sheet in Drive
          </a>{' '}
          — {sheet.row_count} row{sheet.row_count === 1 ? '' : 's'}
          {sheet.built_at && `, rebuilt ${sheet.built_at.slice(0, 10)}`}
        </p>
      ) : (
        <p className="muted small">
          No sheet in Drive for this month yet. It is written each night, and
          rebuilt from the database every time — so an edit made in the
          spreadsheet is replaced, not kept.
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </>
  )
}

function AddUnit({ onClose, onAdded }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/units', {
        method: 'POST',
        body: { name: name.trim(), code: code.trim().toUpperCase(), location: location.trim() },
      })
      onAdded()
    } catch (err) {
      setError(err.payload?.error || err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add a unit">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Add unit</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Montreal Catering Unit" />
        </label>
        <label className="field">
          <span>Short code</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="YUL" maxLength={20} />
          <small className="muted">Appears on every report subject line. Letters, digits, - and _.</small>
        </label>
        <label className="field">
          <span>Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Montreal, Canada" />
        </label>

        <p className="muted small">
          A new unit starts with the full checklist published, so it can be inspected straight away.
        </p>

        {error && <p className="error" role="alert">{error}</p>}

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={save}
            disabled={busy || !name.trim() || !code.trim()}
          >
            {busy ? 'Adding…' : 'Add unit'}
          </button>
        </footer>
      </div>
    </div>
  )
}
