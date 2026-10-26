import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import Brand from '../components/Brand.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'

export default function SetupPage() {
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [form, setForm] = useState({
    organisation: '',
    admin_name: '',
    admin_email: '',
  })

  useEffect(() => {
    api('/setup/status', { auth: false })
      .then((status) => {
        if (status.needs_setup) return setState('ready')
        setState(status.needs_checklist ? 'unfinished' : 'done')
      })
      .catch((err) => {
        setState('broken')
        setError(err.payload?.error || err.message)
      })
  }, [])

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))

  const slug =
    form.organisation
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'main'

  const ready =
    form.organisation.trim() &&
    form.admin_name.trim() &&
    /\S+@\S+\.\S+/.test(form.admin_email)

  const submit = async (event) => {
    event.preventDefault()
    setState('working')
    setError('')

    let created
    try {
      created = await api('/setup', {
        method: 'POST',
        auth: false,
        body: {
          organisation: form.organisation.trim(),
          slug,
          admin_name: form.admin_name.trim(),
          admin_email: form.admin_email.trim(),
          unit_name: 'YUL Catering Unit',
          unit_code: 'YUL',
        },
      })
    } catch (err) {
      setError(err.payload?.error || err.message)
      setState('ready')
      return
    }

    setResult(created)
    setState('installing')
    try {
      const checklist = await api('/setup/checklist', { method: 'POST', auth: false })
      setResult({ ...created, checklist: checklist.checklist })
    } catch (err) {
      setResult({ ...created, checklistError: err.payload?.error || err.message })
    }
    setState('created')
  }

  const installChecklist = async () => {
    setState('installing')
    setError('')
    try {
      const checklist = await api('/setup/checklist', { method: 'POST', auth: false })
      setResult({ checklistOnly: true, checklist: checklist.checklist })
      setState('created')
    } catch (err) {
      setError(err.payload?.error || err.message)
      setState('unfinished')
    }
  }

  return (
    <div className="login">
      <div className="login__card glass glass--strong setup">
        <div className="login__head">
          <Brand />
          <h1>{state === 'created' ? 'You are set up' : 'First-time setup'}</h1>
        </div>

        {state === 'checking' && <p className="muted">Checking this deployment…</p>}

        {state === 'installing' && (
          <p className="muted">Installing the 303-point checklist… this takes a few seconds.</p>
        )}

        {state === 'unfinished' && (
          <>
            <p className="notice notice--warn">
              <strong>Setup was interrupted.</strong>
              <span>
                The organisation and the administrator exist, but the checklist was never
                installed. Finish it now — your account and PIN are unchanged.
              </span>
            </p>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="button" className="btn btn--primary" onClick={installChecklist}>
              Install the checklist
            </button>
          </>
        )}

        {state === 'broken' && (
          <>
            <p className="error" role="alert">{error}</p>
            <p className="muted small">
              The app could not reach its own API. Open <code>/api/health</code> — it lists what
              is missing.
            </p>
          </>
        )}

        {state === 'done' && (
          <>
            <p className="notice notice--done">
              <strong>Already set up.</strong>
              <span>Sign in with the admin account that was created.</span>
            </p>
            <a className="btn btn--primary" href="/app">Go to sign in</a>
          </>
        )}

        {state === 'created' && <Created result={result} />}

        {(state === 'ready' || state === 'working') && (
          <form onSubmit={submit} className="setup__form">
            <p className="muted">
              This runs once and creates your organisation, the YUL unit, and the
              administrator account.
            </p>

            <label>
              Organisation
              <input value={form.organisation} onChange={set('organisation')} placeholder="Gate Gourmet Montreal" autoFocus required />
            </label>

            <label>
              Your name
              <input value={form.admin_name} onChange={set('admin_name')} placeholder="Roy Thevananth" required />
            </label>

            <label>
              Your email
              <input type="email" value={form.admin_email} onChange={set('admin_email')} placeholder="you@example.com" required />
            </label>

            {error && <p className="error" role="alert">{error}</p>}

            <button type="submit" className="btn btn--primary" disabled={!ready || state === 'working'}>
              {state === 'working' ? 'Setting up…' : 'Create my organisation'}
            </button>
          </form>
        )}

        <ThemeToggle />
      </div>
    </div>
  )
}

function Created({ result }) {
  const [copied, setCopied] = useState(false)

  if (result.checklistOnly) {
    return (
      <>
        <p className="notice notice--done">
          <strong>Checklist installed.</strong>
          <span>{result.checklist.items} points published. Setup is complete.</span>
        </p>
        <a className="btn btn--primary" href="/app">Sign in</a>
      </>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.admin.temporary_password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <p className="muted">
        {result.organisation} ·{' '}
        {result.checklist
          ? `${result.checklist.items} checklist points published for ${result.unit.code}`
          : `unit ${result.unit.code}`}
        .
      </p>

      {result.checklistError && (
        <p className="notice notice--warn">
          <strong>The checklist did not install.</strong>
          <span>
            Your account is fine — write the PIN down, sign in, then reload this page to
            finish. ({result.checklistError})
          </span>
        </p>
      )}

      <div className="setup__password">
        <span className="setup__password-label">Your temporary PIN</span>
        <code>{result.admin.temporary_password}</code>
        <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="notice notice--warn">
        <strong>Write this down now.</strong>
        <span>
          It is shown once and stored nowhere you can read back. There is no other
          admin who could reset it for you.
        </span>
      </p>

      <p className="muted small">
        Sign in as <b>{result.admin.username}</b> with that PIN. The app will make you
        choose your own straight away.
      </p>

      <a className="btn btn--primary" href="/app">Sign in</a>
    </>
  )
}
