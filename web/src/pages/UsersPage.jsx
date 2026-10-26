import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { MIN_PIN_LENGTH } from '../lib/rules.js'

/**
 * Accounts, roles and unit access.
 *
 * A role is a starting point, not a cage: every capability can be granted or
 * revoked on one person without inventing a new role for them. That is what
 * the overrides below are, and why the list shows what the role already gives
 * before anybody starts ticking boxes.
 */

const ROLE_LABEL = {
  admin: 'Admin',
  inspector: 'Inspector',
  viewer: 'Viewer',
}

const ROLE_NOTE = {
  admin: 'Full access. Can manage users, checklists, inspections and corrective actions.',
  inspector: 'Walks the floor and fills in checklists. Can raise actions, not close them.',
  viewer: 'Read-only. For a visiting auditor.',
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const [people, setPeople] = useState(null)
  const [units, setUnits] = useState([])
  const [roles, setRoles] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [issued, setIssued] = useState(null)

  const load = async () => {
    try {
      setPeople(await api('/users'))
      setError('')
    } catch (err) {
      setError(err.message)
      setPeople([])
    }
  }

  useEffect(() => {
    load()
    api('/units').then(setUnits).catch(() => setUnits([]))
    api('/users/roles').then(setRoles).catch(() => setRoles(null))
  }, [])

  if (!me.permissions.includes('user.manage')) {
    return (
      <div className="dash">
        <header className="dash__head">
          <div>
            <h1>Users</h1>
          </div>
        </header>
        <div className="empty glass">
          <span className="empty__badge">Not for you</span>
          <p>Managing accounts is an admin's job. Ask one of them.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>Users</h1>
          <p className="muted">Who can sign in, what they may do, and which units they see.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          Add a person
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {issued && (
        <div className="notice notice--warn glass">
          <strong>Temporary PIN for {issued.username}</strong>
          <code className="setup__password-value">{issued.password}</code>
          <span>
            Shown once. They must choose their own PIN the first time they sign in.
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setIssued(null)}>
            Got it
          </button>
        </div>
      )}

      {people === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="userlist">
          {people.map((person) => (
            <li key={person.id}>
              <button type="button" className="userlist__row" onClick={() => setEditing(person)}>
                <span className="userlist__who">
                  <b>
                    {person.full_name || person.username}
                    {person.id === me.id && <small> (you)</small>}
                  </b>
                  <small>
                    {person.username} · {person.email}
                  </small>
                </span>
                <span className="userlist__role">{ROLE_LABEL[person.role] || person.role}</span>
                <span className="userlist__units muted small">YUL</span>
                {!person.active && <span className="userlist__flag">Disabled</span>}
                {person.must_change_password && person.active && (
                  <span className="userlist__flag userlist__flag--soft">PIN not set</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <PersonDialog
          units={units}
          roles={roles}
          onClose={() => setAdding(false)}
          onSaved={(saved, password) => {
            setAdding(false)
            setIssued({ username: saved.username, password })
            load()
          }}
        />
      )}

      {editing && (
        <PersonDialog
          person={editing}
          units={units}
          roles={roles}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(saved, password) => {
            setEditing(null)
            if (password) setIssued({ username: saved.username, password })
            load()
          }}
        />
      )}
    </div>
  )
}

function PersonDialog({ person = null, units, roles, isSelf = false, onClose, onSaved }) {
  const existing = Boolean(person)
  const [form, setForm] = useState(() => ({
    username: person?.username || '',
    full_name: person?.full_name || '',
    email: person?.email || '',
    initials: person?.initials || '',
    role: person?.role || 'inspector',
    password: '',
    active: person ? person.active : true,
    unit_ids: person?.unit_ids ?? [],
  }))
  const [overrides, setOverrides] = useState({})
  const [showPermissions, setShowPermissions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (event) =>
    setForm((f) => ({
      ...f,
      [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
    }))

  const toggleUnit = (id) =>
    setForm((f) => ({
      ...f,
      unit_ids: f.unit_ids.includes(id) ? f.unit_ids.filter((u) => u !== id) : [...f.unit_ids, id],
    }))

  const preset = new Set(roles?.roles.find((r) => r.role === form.role)?.default_permissions || [])
  const needsUnits = false

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        initials: form.initials.trim(),
        role: form.role,
        ...(needsUnits ? { unit_ids: form.unit_ids } : {}),
      }

      let saved
      if (existing) {
        saved = await api(`/users/${person.id}`, {
          method: 'PATCH',
          body: { ...body, active: form.active, ...(form.password ? { password: form.password } : {}) },
        })
      } else {
        saved = await api('/users', {
          method: 'POST',
          body: { ...body, username: form.username.trim(), password: form.password },
        })
      }

      if (Object.keys(overrides).length > 0) {
        saved = await api(`/users/${saved.id}/permissions`, { method: 'PUT', body: { overrides } })
      }
      onSaved(saved, form.password || null)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const passwordNeeded = !existing
  const passwordTooShort = form.password.length > 0 && form.password.length < MIN_PIN_LENGTH

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={existing ? 'Edit person' : 'Add a person'}>
      <div className="modal__panel glass glass--strong">
        <header className="modal__head">
          <h2>{existing ? person.full_name || person.username : 'Add a person'}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!existing && (
          <label className="field">
            <span>Username</span>
            <input value={form.username} onChange={set('username')} placeholder="r.selvarasu" />
            <small className="muted">
              What they type to sign in. Letters, digits, . _ and - only — frontline staff often
              have no company email.
            </small>
          </label>
        )}

        <label className="field">
          <span>Full name</span>
          <input value={form.full_name} onChange={set('full_name')} />
        </label>

        <label className="field">
          <span>Email</span>
          <input type="email" value={form.email} onChange={set('email')} />
        </label>

        <label className="field">
          <span>Role</span>
          <select value={form.role} onChange={set('role')}>
            {Object.keys(ROLE_LABEL).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <small className="muted">{ROLE_NOTE[form.role]}</small>
        </label>

        {needsUnits && (
          <fieldset className="recipients">
            <legend>Units</legend>
            {units.map((unit) => (
              <label key={unit.id} className="recipients__row">
                <input
                  type="checkbox"
                  checked={form.unit_ids.includes(unit.id)}
                  onChange={() => toggleUnit(unit.id)}
                />
                <span>
                  <b>{unit.name}</b> <small>{unit.code}</small>
                </span>
              </label>
            ))}
            {form.unit_ids.length === 0 && (
              <p className="muted small">
                At least one. Without a unit this account can sign in and see nothing, which
                looks like a broken app rather than a permissions problem.
              </p>
            )}
          </fieldset>
        )}

        <label className="field">
          <span>{existing ? 'Reset their PIN' : 'Temporary PIN'}</span>
          <input
            type="text"
            value={form.password}
            onChange={set('password')}
            placeholder={existing ? 'Leave blank to keep the current one' : ''}
            autoComplete="off"
          />
          <small className={passwordTooShort ? 'error' : 'muted'}>
            At least {MIN_PIN_LENGTH} digits. They choose their own on first sign-in.
          </small>
        </label>

        {existing && (
          <label className="capafilters__mine">
            <input type="checkbox" checked={form.active} onChange={set('active')} disabled={isSelf} />
            <span>Can sign in{isSelf ? ' (you cannot disable yourself)' : ''}</span>
          </label>
        )}

        {roles && (
          <>
            <button type="button" className="linkish" onClick={() => setShowPermissions((v) => !v)}>
              {showPermissions ? 'Hide' : 'Fine-tune'} individual permissions
            </button>

            {showPermissions && (
              <div className="permgrid">
                {roles.all_permissions.map((permission) => {
                  const fromRole = preset.has(permission)
                  const override = overrides[permission]
                  const effective = override === undefined ? fromRole : override
                  return (
                    <label key={permission} className="permgrid__row">
                      <input
                        type="checkbox"
                        checked={effective}
                        onChange={(e) =>
                          setOverrides((current) => {
                            const next = { ...current }
                            // Back to what the role says is "no override",
                            // not "explicitly the same" - so a later change of
                            // role carries this permission with it.
                            if (e.target.checked === fromRole) next[permission] = null
                            else next[permission] = e.target.checked
                            return next
                          })
                        }
                      />
                      <span>
                        {permission}
                        {override !== undefined && override !== null && <b> (overridden)</b>}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={save}
            disabled={
              busy ||
              passwordTooShort ||
              (passwordNeeded && form.password.length < MIN_PIN_LENGTH) ||
              (!existing && form.username.trim().length < 3) ||
              !form.full_name.trim() ||
              (needsUnits && form.unit_ids.length === 0)
            }
          >
            {busy ? 'Saving…' : existing ? 'Save' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  )
}
