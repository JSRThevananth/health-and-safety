import { Link } from 'react-router-dom'

export default function Layout({ children }) {
  return (
    <div>
      <nav className="nav">
        <h3>Sanitation KPI Program</h3>
        <div>
          <Link to="/entry">Data Entry</Link>
          <Link to="/deviations">Deviations/CAPA</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/reports">Reports</Link>
        </div>
      </nav>
      <main className="container">{children}</main>
    </div>
  )
}
