import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DataEntryPage from './pages/DataEntryPage'
import DeviationsPage from './pages/DeviationsPage'
import DashboardPage from './pages/DashboardPage'
import ReportsPage from './pages/ReportsPage'

function Protected({ children }) {
  const token = localStorage.getItem('token')
  return token ? children : <Navigate to="/login" />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<Protected><Layout><Routes>
        <Route path="entry" element={<DataEntryPage />} />
        <Route path="deviations" element={<DeviationsPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="entry" />} />
      </Routes></Layout></Protected>} />
    </Routes>
  )
}
