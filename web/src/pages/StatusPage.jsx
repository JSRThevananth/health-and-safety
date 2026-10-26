import { useEffect, useState } from 'react'
import { api, health } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'

const ROLE_LABELS = {
  admin: 'Administrator',
  unit_manager: 'Unit H&S Manager',
  inspector: 'Inspector',
  viewer: 'Viewer',
}

/**
 * Interim home screen. It shows the signed-in user exactly what they can reach, which
 * is the fastest way to verify unit scoping while the inspection module is built.
 */
export default function StatusPage() {
  const { user, signOut } = useAuth()
  const [status, setStatus] = useState(null)
  const [units, setUnits] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([health(), api('/units')])
      .then(([healthData, unitData]) => {
        setStatus(healthData)
        setUnits(unitData)
      })
      .catch((err) => setError(err.message))
  }, [])

  const tenantWide = user.unit_ids === null

  return (
    <div className="page">
      <header className="row">
        <div>
          <h1>Health &amp; Safety Platform</h1>
          <p className="muted small">
            {user.full_name} — {ROLE_LABELS[user.role] || user.role}
          </p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>
          Your units
          <span className={tenantWide ? 'badge badge-ok' : 'badge badge-idle'}>
            {tenantWide ? 'All units' : `${units.length} assigned`}
          </span>
        </h2>
        {units.length === 0 ? (
          <p className="muted">No units assigned.</p>
        ) : (
          <ul className="list">
            {units.map((unit) => (
              <li key={unit.id}>
                <strong>{unit.name}</strong>
                <span className="muted"> · {unit.code}{unit.location && ` · ${unit.location}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Your access</h2>
        <ul className="chips">
          {user.permissions.map((permission) => (
            <li key={permission} className="chip">{permission}</li>
          ))}
        </ul>
      </section>

      {status && (
        <section className="card">
          <h2>System</h2>
          <dl className="grid">
            <dt>API</dt>
            <dd><span className="badge badge-ok">{status.status}</span></dd>
            <dt>Email</dt>
            <dd>
              <span className={`badge ${status.email === 'brevo' ? 'badge-ok' : 'badge-idle'}`}>
                {status.email === 'brevo' ? 'Brevo (live)' : 'dry-run'}
              </span>
            </dd>
            <dt>Storage</dt>
            <dd>
              <span className={`badge ${status.storage === 'gdrive' ? 'badge-ok' : 'badge-idle'}`}>
                {status.storage === 'gdrive' ? 'Google Drive' : 'local disk'}
              </span>
            </dd>
          </dl>
        </section>
      )}

      <p className="muted small">
        Access control only. Inspection forms, CAPAs and reporting come next.
      </p>
    </div>
  )
}
