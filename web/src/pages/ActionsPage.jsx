import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

/**
 * Corrective actions.
 *
 * A worklist before it is a register: the default view is what is still open,
 * soonest due at the top, because the question people come here with is "what
 * do I have to do", not "show me everything we have ever raised".
 */

const PRIORITY_LABEL = { high: 'High', normal: 'Normal', low: 'Low' }
const STATUS_LABEL = { open: 'Open', done: 'Done', cancelled: 'Cancelled' }

export default function ActionsPage() {
  const { user } = useAuth()
  const [capas, setCapas] = useState(null)
  const [units, setUnits] = useState([])
  const [people, setPeople] = useState([])
  const [filter, setFilter] = useState({ status: 'open', mine: false, unit_id: '' })
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [raising, setRaising] = useState(false)

  const canRaise = user.permissions.includes('capa.create')
  const canAssign = user.permissions.includes('capa.assign')
  const canClose = user.permissions.includes('capa.close')

  const load = async () => {
    const query = new URLSearchParams()
    if (filter.status) query.set('status', filter.status)
    if (filter.mine) query.set('mine', 'true')
    if (filter.unit_id) query.set('unit_id', filter.unit_id)
    try {
      setCapas(await api(`/capas?${query}`))
      setError('')
    } catch (err) {
      setError(err.message)
      setCapas([])
    }
  }

  useEffect(() => {
    load()
  }, [filter.status, filter.mine, filter.unit_id])

  useEffect(() => {
    api('/units').then(setUnits).catch(() => setUnits([]))
    // Only an admin can list people; everyone else just sees the names already
    // on the actions, which is enough to read the list.
    if (user.permissions.includes('user.manage')) {
      api('/users').then((rows) => setPeople(rows.filter((u) => u.active))).catch(() => setPeople([]))
    }
  }, [])

  const overdue = useMemo(() => (capas || []).filter((c) => c.overdue).length, [capas])

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>Corrective actions</h1>
          <p className="muted">
            What was found, who is fixing it, and what they did about it.
            {overdue > 0 && <b className="capa__overdueflag"> {overdue} overdue</b>}
          </p>
        </div>
        {canRaise && (
          <button type="button" className="btn btn--primary" onClick={() => setRaising(true)}>
            Raise an action
          </button>
        )}
      </header>

      <div className="capafilters">
        <div className="segmented" role="group" aria-label="Filter by status">
          {['open', 'done', ''].map((value) => (
            <button
              key={value || 'all'}
              type="button"
              className={filter.status === value ? 'is-on' : ''}
              onClick={() => setFilter((f) => ({ ...f, status: value }))}
            >
              {value ? STATUS_LABEL[value] : 'All'}
            </button>
          ))}
        </div>

        <label className="capafilters__mine">
          <input
            type="checkbox"
            checked={filter.mine}
            onChange={(e) => setFilter((f) => ({ ...f, mine: e.target.checked }))}
          />
          <span>Assigned to me</span>
        </label>

        {units.length > 1 && (
          <select
            value={filter.unit_id}
            onChange={(e) => setFilter((f) => ({ ...f, unit_id: e.target.value }))}
            aria-label="Filter by unit"
          >
            <option value="">All units</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {capas === null ? (
        <p className="muted">Loading…</p>
      ) : capas.length === 0 ? (
        <div className="empty glass">
          <span className="empty__badge">Nothing here</span>
          <p>
            {filter.status === 'open'
              ? 'No open actions. Raise one from a finding when you sign off an inspection.'
              : 'No actions match this filter.'}
          </p>
        </div>
      ) : (
        <ul className="capalist">
          {capas.map((capa) => (
            <li key={capa.id}>
              <button type="button" className="capalist__row" onClick={() => setOpen(capa.id)}>
                <span className={`capapill capapill--${capa.priority}`}>{PRIORITY_LABEL[capa.priority]}</span>
                <span className="capalist__title">
                  <b>{capa.title}</b>
                  <small>
                    {capa.unit_code}
                    {capa.owner_name ? ` · ${capa.owner_name}` : ' · unassigned'}
                    {capa.inspection_id ? ` · from inspection #${capa.inspection_id}` : ''}
                  </small>
                </span>
                <span className={`capalist__due${capa.overdue ? ' is-overdue' : ''}`}>
                  {capa.status === 'open'
                    ? capa.due_date
                      ? `${capa.overdue ? 'Overdue ' : 'Due '}${capa.due_date}`
                      : 'No date'
                    : STATUS_LABEL[capa.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ActionDetail
          id={open}
          people={people}
          canAssign={canAssign}
          canClose={canClose}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null)
            load()
          }}
        />
      )}

      {raising && (
        <RaiseAction
          units={units}
          people={people}
          onClose={() => setRaising(false)}
          onRaised={() => {
            setRaising(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function ActionDetail({ id, people, canAssign, canClose, onClose, onChanged }) {
  const [capa, setCapa] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setCapa(await api(`/capas/${id}`))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [id])

  const save = async (body) => {
    setBusy('save')
    setError('')
    try {
      await api(`/capas/${id}`, { method: 'PATCH', body })
      await load()
    } catch (err) {
      setError(err.payload?.error || err.message)
    } finally {
      setBusy('')
    }
  }

  const finish = async (status) => {
    setBusy(status)
    setError('')
    try {
      await api(`/capas/${id}/close`, { method: 'POST', body: { note: note.trim(), status } })
      onChanged()
    } catch (err) {
      setError(err.message)
      setBusy('')
    }
  }

  const reopen = async () => {
    setBusy('reopen')
    setError('')
    try {
      await api(`/capas/${id}/reopen`, { method: 'POST', body: { reason: note.trim() } })
      onChanged()
    } catch (err) {
      setError(err.message)
      setBusy('')
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Corrective action">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>{capa ? capa.title : 'Action'}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!capa ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {capa.detail && <p className="capadetail__detail">{capa.detail}</p>}

            <dl className="capadetail__facts">
              <div>
                <dt>Unit</dt>
                <dd>{capa.unit_name}</dd>
              </div>
              <div>
                <dt>Raised</dt>
                <dd>
                  {capa.created_at.slice(0, 10)}
                  {capa.raised_by_name ? ` by ${capa.raised_by_name}` : ''}
                </dd>
              </div>
              {capa.inspection_id && (
                <div>
                  <dt>From</dt>
                  <dd>Inspection #{capa.inspection_id}</dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>
                  {STATUS_LABEL[capa.status]}
                  {capa.overdue && <b className="capa__overdueflag"> overdue</b>}
                </dd>
              </div>
            </dl>

            {capa.status === 'open' && canAssign && (
              <div className="capadetail__assign">
                <label className="field">
                  <span>Owner</span>
                  <select
                    value={capa.owner_id || ''}
                    onChange={(e) => save({ owner_id: e.target.value ? Number(e.target.value) : null })}
                    disabled={Boolean(busy)}
                  >
                    <option value="">Unassigned</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name || person.username}
                      </option>
                    ))}
                    {/* The current owner, when this caller cannot list people. */}
                    {capa.owner_id && !people.some((p) => p.id === capa.owner_id) && (
                      <option value={capa.owner_id}>{capa.owner_name}</option>
                    )}
                  </select>
                </label>

                <label className="field">
                  <span>Due</span>
                  <input
                    type="date"
                    defaultValue={capa.due_date || ''}
                    onBlur={(e) => e.target.value !== capa.due_date && save({ due_date: e.target.value })}
                    disabled={Boolean(busy)}
                  />
                </label>

                <label className="field">
                  <span>Priority</span>
                  <select
                    value={capa.priority}
                    onChange={(e) => save({ priority: e.target.value })}
                    disabled={Boolean(busy)}
                  >
                    {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {capa.status !== 'open' && capa.closing_note && (
              <p className="capadetail__closing">
                <b>{STATUS_LABEL[capa.status]}:</b> {capa.closing_note}
              </p>
            )}

            <h3 className="unitcard__sub">History</h3>
            <ol className="capahistory">
              {capa.events.map((event) => (
                <li key={event.id}>
                  <b>{event.kind}</b> · {event.at.slice(0, 16).replace('T', ' ')}
                  {event.actor_name ? ` · ${event.actor_name}` : ''}
                  {event.detail && <div className="muted small">{event.detail}</div>}
                </li>
              ))}
            </ol>

            {canClose && (
              <label className="field">
                <span>{capa.status === 'open' ? 'What was done' : 'Why reopen it'}</span>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    capa.status === 'open'
                      ? 'Closer fitted and tested, 11 Oct'
                      : 'Floor still wet the next morning'
                  }
                />
                <small className="muted">
                  Required. A tick with nothing behind it is what this log exists to avoid.
                </small>
              </label>
            )}

            {error && <p className="error" role="alert">{error}</p>}

            <footer className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Close
              </button>
              {canClose && capa.status === 'open' && (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => finish('cancelled')}
                    disabled={Boolean(busy) || note.trim().length < 3}
                  >
                    Cancel action
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => finish('done')}
                    disabled={Boolean(busy) || note.trim().length < 3}
                  >
                    {busy === 'done' ? 'Saving…' : 'Mark done'}
                  </button>
                </>
              )}
              {canClose && capa.status !== 'open' && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={reopen}
                  disabled={Boolean(busy) || note.trim().length < 3}
                >
                  {busy === 'reopen' ? 'Saving…' : 'Reopen'}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function RaiseAction({ units, people, onClose, onRaised }) {
  const [form, setForm] = useState({
    unit_id: units[0]?.id || '',
    title: '',
    detail: '',
    priority: 'normal',
    owner_id: '',
    due_date: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/capas', {
        method: 'POST',
        body: {
          unit_id: Number(form.unit_id),
          title: form.title.trim(),
          detail: form.detail.trim(),
          priority: form.priority,
          ...(form.owner_id ? { owner_id: Number(form.owner_id) } : {}),
          ...(form.due_date ? { due_date: form.due_date } : {}),
        },
      })
      onRaised()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Raise a corrective action">
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>Raise an action</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {units.length > 1 && (
          <label className="field">
            <span>Unit</span>
            <select value={form.unit_id} onChange={set('unit_id')}>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>What needs doing</span>
          <input value={form.title} onChange={set('title')} placeholder="Fit a closer to fire door 3" />
        </label>

        <label className="field">
          <span>Detail</span>
          <textarea rows={2} value={form.detail} onChange={set('detail')} placeholder="Optional" />
        </label>

        <div className="capadetail__assign">
          <label className="field">
            <span>Priority</span>
            <select value={form.priority} onChange={set('priority')}>
              {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select value={form.owner_id} onChange={set('owner_id')}>
              <option value="">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || person.username}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due</span>
            <input type="date" value={form.due_date} onChange={set('due_date')} />
          </label>
        </div>
        <p className="muted small">
          Leave the date blank and it gets one by priority — three days for high, a fortnight
          for normal.
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
            disabled={busy || form.title.trim().length < 3 || !form.unit_id}
          >
            {busy ? 'Raising…' : 'Raise'}
          </button>
        </footer>
      </div>
    </div>
  )
}
