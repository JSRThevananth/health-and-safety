import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

export default function LoginPage() {
  const [username, setUsername] = useState('qa1')
  const [password, setPassword] = useState('qa123')
  const [err, setErr] = useState('')
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    try {
      const { data } = await api.post('/auth/login', { username, password })
      localStorage.setItem('token', data.access_token)
      navigate('/entry')
    } catch {
      setErr('Invalid login')
    }
  }

  return <div className="login"><form onSubmit={submit} className="card"><h2>Login</h2>
    <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" />
    <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" />
    {err && <p className="err">{err}</p>}
    <button>Sign In</button>
  </form></div>
}
