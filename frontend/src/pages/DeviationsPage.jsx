import { useEffect, useState } from 'react'
import api from '../services/api'

export default function DeviationsPage() {
  const [deviations, setDeviations] = useState([])
  const [actions, setActions] = useState([])
  const [users, setUsers] = useState([])
  const [areas, setAreas] = useState([])
  const [form, setForm] = useState({ task_id:'', area_id:'', category:'', description:'', severity:'Major', is_repeat:false })
  const [caForm, setCaForm] = useState({ deviation_id:'', action_description:'', owner_id:'', due_date:'', status:'Open', performed_by_initials:'' })

  async function load() {
    const [d, c, u, a] = await Promise.all([api.get('/deviations'), api.get('/corrective-actions'), api.get('/users'), api.get('/areas')])
    setDeviations(d.data)
    setActions(c.data)
    setUsers(u.data)
    setAreas(a.data)
  }
  useEffect(() => { load() }, [])

  const areaName = (areaId) => areas.find(a => a.id === areaId)?.name || '-'

  return <div className="grid2">
    <form className="card" onSubmit={async e => {
      e.preventDefault()
      await api.post('/deviations', {
        ...form,
        task_id: form.task_id ? Number(form.task_id) : null,
        area_id: Number(form.area_id)
      })
      load()
    }}>
      <h3>Log Department Deviation</h3>
      <select required onChange={e => setForm({...form, area_id:e.target.value})}>
        <option value="">Department</option>
        {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input placeholder="Task ID (optional)" onChange={e => setForm({...form, task_id:e.target.value})} />
      <input placeholder="Category" required onChange={e => setForm({...form, category:e.target.value})} />
      <textarea placeholder="Description" required onChange={e => setForm({...form, description:e.target.value})} />
      <select onChange={e => setForm({...form, severity:e.target.value})}><option>Minor</option><option>Major</option><option>Critical</option></select>
      <label><input type="checkbox" onChange={e => setForm({...form, is_repeat:e.target.checked})} /> Repeat deviation</label>
      <button>Create Deviation</button>
    </form>

    <form className="card" onSubmit={async e => {
      e.preventDefault()
      await api.post('/corrective-actions', {
        ...caForm,
        deviation_id:Number(caForm.deviation_id),
        owner_id:Number(caForm.owner_id),
        performed_by_initials: caForm.performed_by_initials.trim().toUpperCase()
      })
      load()
    }}>
      <h3>Corrective Action</h3>
      <input placeholder="Deviation ID" required onChange={e => setCaForm({...caForm, deviation_id:e.target.value})} />
      <textarea placeholder="Action Description" required onChange={e => setCaForm({...caForm, action_description:e.target.value})} />
      <input placeholder="Initials (e.g. JD)" maxLength={12} required onChange={e => setCaForm({...caForm, performed_by_initials:e.target.value})} />
      <select required onChange={e => setCaForm({...caForm, owner_id:Number(e.target.value)})}><option value="">Owner</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <input type="date" required onChange={e => setCaForm({...caForm, due_date:e.target.value})} />
      <select onChange={e => setCaForm({...caForm, status:e.target.value})}><option>Open</option><option>Closed</option></select>
      <button>Create CA</button>
    </form>

    <div className="card full"><h3>Deviation Log</h3><table><thead><tr><th>ID</th><th>Department</th><th>Task</th><th>Category</th><th>Severity</th><th>Status</th></tr></thead><tbody>{deviations.map(d => <tr key={d.id}><td>{d.id}</td><td>{areaName(d.area_id)}</td><td>{d.task_id || '-'}</td><td>{d.category}</td><td>{d.severity}</td><td>{d.status}</td></tr>)}</tbody></table></div>

    <div className="card full"><h3>Corrective Action Log</h3><table><thead><tr><th>ID</th><th>Deviation</th><th>Action</th><th>Owner ID</th><th>Initials</th><th>Status</th></tr></thead><tbody>{actions.map(a => <tr key={a.id}><td>{a.id}</td><td>{a.deviation_id}</td><td>{a.action_description}</td><td>{a.owner_id}</td><td>{a.performed_by_initials || '-'}</td><td>{a.status}</td></tr>)}</tbody></table></div>
  </div>
}
