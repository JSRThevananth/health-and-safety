import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import { api } from '../lib/api.js'
import Brand from '../components/Brand.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // A brand-new deployment has no accounts at all, so showing only a sign-in
  // form is a dead end. Ask once and point at setup if that is where they are.
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
    let cancelled = false
    api('/setup/status', { auth: false })
      .then((status) => !cancelled && setNeedsSetup(status.needs_setup))
      .catch(() => {}) // An older deployment has no such route; the form still works.
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(username, password)
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
          <h1>Sign in</h1>
        </div>

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {needsSetup && (
          <p className="notice notice--warn">
            <strong>This deployment has no accounts yet.</strong>
            <Link to="/setup">Set it up now →</Link>
          </p>
        )}

        <div className="login__foot">
          <Link className="link-quiet" to="/">← Back to overview</Link>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><ThemeToggle /></div>
      </form>
    </div>
  )
}
