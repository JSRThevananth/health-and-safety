import { useEffect, useState } from 'react'
import api from '../services/api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function DashboardPage() {
  const [kpi, setKpi] = useState({})
  const [filters, setFilters] = useState({ start_date:'', end_date:'', shift_id:'', area_id:'', team:'', supervisor:'', include_allergen:true })

  async function load() {
    const { data } = await api.get('/kpis', { params: filters })
    setKpi(data)
  }
  useEffect(() => { load() }, [])

  const chartData = Object.entries(kpi).map(([name, value]) => ({ name, value: Number(value) }))

  return <div className="card">
    <h3>KPI Dashboard</h3>
    <div className="filters">
      <input type="date" onChange={e => setFilters({...filters, start_date:e.target.value})} />
      <input type="date" onChange={e => setFilters({...filters, end_date:e.target.value})} />
      <input placeholder="Shift ID" onChange={e => setFilters({...filters, shift_id:e.target.value})} />
      <input placeholder="Area ID" onChange={e => setFilters({...filters, area_id:e.target.value})} />
      <input placeholder="Team" onChange={e => setFilters({...filters, team:e.target.value})} />
      <input placeholder="Supervisor" onChange={e => setFilters({...filters, supervisor:e.target.value})} />
      <label><input type="checkbox" defaultChecked onChange={e => setFilters({...filters, include_allergen:e.target.checked})} /> Include allergen KPI</label>
      <button onClick={load}>Apply Filters</button>
    </div>
    <div className="kpiGrid">{Object.entries(kpi).map(([key, val]) => <div key={key}><h4>{key}</h4><p>{val}</p></div>)}</div>
    <div style={{height: 320}}>
      <ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2563eb"/></BarChart></ResponsiveContainer>
    </div>
  </div>
}
