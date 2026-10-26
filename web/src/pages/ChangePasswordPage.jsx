import { useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import Brand from '../components/Brand.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import { MIN_PASSWORD_LENGTH } from '../lib/rules.js'



/**
 * Shown when the signed-in account still holds an admin-issued temporary password.
 * The API blocks every other route until this succeeds, so this is not a screen the
 * client may choose to skip.
 */
export default function ChangePasswordPage() {
  const { user, refresh, signOut } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && next !== confirm
  const sameAsCurrent = next.length > 0 && next === current
  const canSubmit = next.length >= MIN_PASSWORD_LENGTH && next === confirm && !sameAsCurrent && current

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__head">
          <Brand />
          <h1>Choose your password</h1>
          <p className="muted small">
            Signed in as <strong>{user.full_name}</strong>. Replace the temporary password
            you were issued before continuing.
          </p>
        </div>

        <label>
          Temporary password
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>

        <label>
          New password
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          <span className={`hint${tooShort || sameAsCurrent ? ' hint--bad' : ''}`}>
            {sameAsCurrent
              ? 'Must be different from the temporary password'
              : `At least ${MIN_PASSWORD_LENGTH} characters`}
          </span>
        </label>

        <label>
          Confirm new password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {mismatch && <span className="hint hint--bad">Passwords do not match</span>}
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn btn--primary" disabled={busy || !canSubmit}>
          {busy ? 'Saving…' : 'Set password and continue'}
        </button>

        <div className="login__foot">
          <button type="button" className="link-quiet linkish" onClick={signOut}>
            Sign in as someone else
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><ThemeToggle /></div>
      </form>
    </div>
  )
}
