import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import Brand from './Brand.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { useAuth } from '../lib/auth.jsx'

const NAV = [
  { to: '/app', label: 'Dashboard', end: true, permission: 'report.view' },
  { to: '/app/inspections', label: 'Inspections', permission: 'inspection.view' },
  { to: '/app/checklist', label: 'Checklist', permission: 'template.view' },
  { to: '/app/actions', label: 'Corrective actions', permission: 'capa.create' },
  { to: '/app/users', label: 'Users', permission: 'user.manage' },
]

/** Sidebar on desktop, slide-over drawer on mobile. */
export default function AppShell({ children }) {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const allowed = NAV.filter((item) => user.permissions.includes(item.permission))

  return (
    <div className="shell">
      <header className="shell__bar">
        <button
          type="button"
          className="shell__burger"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
        <Brand size="sm" />
        <div className="shell__bar-actions">
          <ThemeToggle />
        </div>
      </header>

      {open && <div className="shell__scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`shell__nav${open ? ' is-open' : ''}`}>
        <div className="shell__nav-brand"><Brand /></div>
        <nav>
          {allowed.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="shell__user">
          {/* The top bar is hidden on desktop, so the sidebar carries its own toggle. */}
          <div className="shell__user-theme"><ThemeToggle /></div>
          <span className="shell__user-name">{user.full_name}</span>
          <span className="shell__user-role">{user.role.replace('_', ' ')}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="shell__main">{children}</main>
    </div>
  )
}
