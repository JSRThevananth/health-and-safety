import { Hono } from 'hono'
import { z } from 'zod'
import { now } from '../db.js'
import { validateBody } from '../middleware/validate.js'
import { requirePermission, requireUnitAccess } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'

// Mounted at /units/:unit_id/recipients, so unit scoping applies to every route.
const recipients = new Hono()

recipients.use('*', requireUnitAccess('unit_id'))

const REPORT_TYPES = ['inspection', 'monthly']

const recipientSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(120).default(''),
  report_type: z.enum(REPORT_TYPES).default('inspection'),
  default_selected: z.boolean().default(true),
})

async function unitOf(c) {
  const unit = await c.get('db').get('SELECT * FROM units WHERE id = @id AND tenant_id = @t', {
    id: c.req.param('unit_id'),
    t: c.get('user').tenantId,
  })
  if (!unit) throw fail(404, 'Unit not found')
  return unit
}

recipients.get('/', requirePermission('unit.view'), async (c) => {
  await unitOf(c)
  return c.json(
    await c.get('db').all(
      `SELECT * FROM unit_recipients WHERE unit_id = @u AND active = 1
       ORDER BY report_type, email`,
      { u: c.req.param('unit_id') }
    )
  )
})

recipients.post('/', requirePermission('recipient.manage'), validateBody(recipientSchema), async (c) => {
  const unit = await unitOf(c)
  const db = c.get('db')
  const body = c.get('body')

  const existing = await db.get(
    'SELECT * FROM unit_recipients WHERE unit_id = @u AND email = @e AND report_type = @r',
    { u: unit.id, e: body.email, r: body.report_type }
  )
  // Re-adding someone who was removed should bring them back rather than fail on
  // a constraint the person adding them cannot see.
  if (existing) {
    if (existing.active) throw fail(409, `${body.email} already receives the ${body.report_type} report`)
    await db.run(
      'UPDATE unit_recipients SET active = 1, name = @n, default_selected = @d WHERE id = @id',
      { n: body.name, d: body.default_selected ? 1 : 0, id: existing.id }
    )
    return c.json(await db.get('SELECT * FROM unit_recipients WHERE id = @id', { id: existing.id }), 200)
  }

  const { id } = await db.insert(
    `INSERT INTO unit_recipients (unit_id, email, name, report_type, default_selected, created_by, created_at)
     VALUES (@unit_id, @email, @name, @report_type, @default_selected, @by, @at)`,
    {
      unit_id: unit.id,
      email: body.email,
      name: body.name,
      report_type: body.report_type,
      default_selected: body.default_selected ? 1 : 0,
      by: c.get('user').id,
      at: now(),
    }
  )
  return c.json(await db.get('SELECT * FROM unit_recipients WHERE id = @id', { id }), 201)
})

recipients.patch(
  '/:id',
  requirePermission('recipient.manage'),
  validateBody(recipientSchema.partial()),
  async (c) => {
    const unit = await unitOf(c)
    const db = c.get('db')
    const existing = await db.get('SELECT * FROM unit_recipients WHERE id = @id AND unit_id = @u', {
      id: c.req.param('id'),
      u: unit.id,
    })
    if (!existing) throw fail(404, 'Recipient not found')

    const next = { ...existing, ...c.get('body') }
    await db.run(
      `UPDATE unit_recipients SET email = @email, name = @name, report_type = @report_type,
         default_selected = @default_selected WHERE id = @id`,
      {
        email: next.email,
        name: next.name,
        report_type: next.report_type,
        default_selected: next.default_selected ? 1 : 0,
        id: existing.id,
      }
    )
    return c.json(await db.get('SELECT * FROM unit_recipients WHERE id = @id', { id: existing.id }))
  }
)

/** Deactivate rather than delete, so the email log still names a real recipient. */
recipients.delete('/:id', requirePermission('recipient.manage'), async (c) => {
  const unit = await unitOf(c)
  const db = c.get('db')
  const existing = await db.get('SELECT * FROM unit_recipients WHERE id = @id AND unit_id = @u', {
    id: c.req.param('id'),
    u: unit.id,
  })
  if (!existing) throw fail(404, 'Recipient not found')

  await db.run('UPDATE unit_recipients SET active = 0 WHERE id = @id', { id: existing.id })
  return c.body(null, 204)
})

export default recipients
