import { useEffect, useState } from 'react'
import api from '../services/api'

export default function DataEntryPage() {
  const [areas, setAreas] = useState([])
  const [shifts, setShifts] = useState([])
  const [users, setUsers] = useState([])
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ task_date: new Date().toISOString().slice(0,10), area_id: '', shift_id: '', staff_id: '', planned_start: '', planned_end: '', actual_start: '', actual_end: '', status: 'Completed', notes: '', chemical_compliant: true, allergen_changeover: false, allergen_pass: true })
  const [vForm, setVForm] = useState({ task_id: '', check_type: 'visual', value: '', passed: true, checked_by: '' })

  useEffect(() => { Promise.all([api.get('/areas'), api.get('/shifts'), api.get('/users')]).then(([a,s,u]) => { setAreas(a.data); setShifts(s.data); setUsers(u.data); }) }, [])

  async function createTask(e) {
    e.preventDefault()
    await api.post('/tasks', { ...form, value: undefined })
    setMsg('Task saved')
  }

  async function createVerification(e) {
    e.preventDefault()
    await api.post('/verifications', { ...vForm, value: vForm.value ? Number(vForm.value) : null, task_id: Number(vForm.task_id), checked_by: Number(vForm.checked_by) })
    setMsg('Verification saved')
  }

  return <div className="grid2">
    <form className="card" onSubmit={createTask}><h3>Daily Sanitation Task Entry</h3>
      <input type="date" value={form.task_date} onChange={e => setForm({...form, task_date: e.target.value})} />
      <select onChange={e => setForm({...form, area_id:Number(e.target.value)})}><option>Area</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select onChange={e => setForm({...form, shift_id:Number(e.target.value)})}><option>Shift</option>{shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select onChange={e => setForm({...form, staff_id:Number(e.target.value)})}><option>Staff</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <label>Planned start/end</label><input type="datetime-local" onChange={e => setForm({...form, planned_start: e.target.value})}/><input type="datetime-local" onChange={e => setForm({...form, planned_end: e.target.value})}/>
      <label>Actual start/end</label><input type="datetime-local" onChange={e => setForm({...form, actual_start: e.target.value})}/><input type="datetime-local" onChange={e => setForm({...form, actual_end: e.target.value})}/>
      <select onChange={e => setForm({...form, status:e.target.value})}><option>Completed</option><option>Reclean</option><option>Pending</option></select>
      <textarea placeholder="Notes" onChange={e => setForm({...form, notes:e.target.value})}></textarea>
      <label><input type="checkbox" defaultChecked onChange={e=>setForm({...form, chemical_compliant:e.target.checked})}/> Chemical compliant</label>
      <label><input type="checkbox" onChange={e=>setForm({...form, allergen_changeover:e.target.checked})}/> Allergen changeover</label>
      <label><input type="checkbox" defaultChecked onChange={e=>setForm({...form, allergen_pass:e.target.checked})}/> Allergen pass</label>
      <button>Save Task</button>
    </form>

    <form className="card" onSubmit={createVerification}><h3>Verification Entry</h3>
      <input type="number" placeholder="Task ID" onChange={e => setVForm({...vForm, task_id:e.target.value})} />
      <select onChange={e => setVForm({...vForm, check_type:e.target.value})}><option value="visual">Visual</option><option value="atp">ATP</option><option value="tpc">TPC</option></select>
      <input placeholder="Value (optional)" onChange={e => setVForm({...vForm, value:e.target.value})} />
      <select onChange={e => setVForm({...vForm, passed:e.target.value === 'true'})}><option value="true">Pass</option><option value="false">Fail</option></select>
      <select onChange={e => setVForm({...vForm, checked_by:Number(e.target.value)})}><option>Checked by</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <button>Add Verification</button>
      {msg && <p>{msg}</p>}
    </form>
  </div>
}
