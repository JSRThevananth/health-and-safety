import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import AppShell from './components/AppShell.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ChangePasswordPage from './pages/ChangePasswordPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ActionsPage from './pages/ActionsPage.jsx'
import ChecklistPage from './pages/ChecklistPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import InspectionPage from './pages/InspectionPage.jsx'
import UnitsPage from './pages/UnitsPage.jsx'
import SetupPage from './pages/SetupPage.jsx'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="centered muted">Loading…</div>
  if (!user) return <LoginPage />
  // The API refuses every other route in this state, so there is nothing else to show.
  if (user.must_change_password) return <ChangePasswordPage />
  return <AppShell>{children}</AppShell>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      {/* Public by necessity: there is nobody to sign in as until it has run. */}
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/app" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/app/inspections" element={<Protected><InspectionPage /></Protected>} />
      <Route path="/app/checklist" element={<Protected><ChecklistPage /></Protected>} />
      <Route path="/app/actions" element={<Protected><ActionsPage /></Protected>} />
      <Route path="/app/units" element={<Protected><UnitsPage /></Protected>} />
      <Route path="/app/users" element={<Protected><UsersPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
