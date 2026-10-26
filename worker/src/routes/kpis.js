import { Hono } from 'hono'
import { requirePermission } from '../middleware/auth.js'
import { dashboardKpis } from '../services/kpis.js'

const kpis = new Hono()

/** Everything the dashboard draws, in one request. */
kpis.get('/', requirePermission('unit.view'), async (c) =>
  c.json(await dashboardKpis(c.get('db'), { unitIds: c.get('user').unitIds }))
)

export default kpis
