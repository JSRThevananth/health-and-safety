const base = 'http://localhost:8000'

const exports = ['tasks', 'verifications', 'deviations', 'corrective_actions']

export default function ReportsPage() {
  return <div className="card"><h3>Reports & Exports</h3><ul>
    {exports.map(x => <li key={x}><a href={`${base}/exports/${x}`} target="_blank">Download {x}.csv</a></li>)}
    <li><a href={`${base}/exports/kpi-summary`} target="_blank">Download KPI Summary CSV</a></li>
  </ul></div>
}
