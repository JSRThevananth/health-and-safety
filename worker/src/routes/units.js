import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { requirePermission, requireUnitAccess } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'

const units = new Hono()

const unitSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only'),
  location: z.string().max(200).default(''),
  timezone: z.string().max(60).default('UTC'),
})

/** Admins see every unit in their tenant; everyone else only their assigned units. */
units.get('/', requirePermission('unit.view'), async (c) => {
  const db = c.get('db')
  const user = c.get('user')

  if (user.unitIds === null) {
    return c.json(
      await db.all('SELECT * FROM units WHERE tenant_id = @t AND active = 1 ORDER BY name', {
        t: user.tenantId,
      })
    )
  }
  if (user.unitIds.length === 0) return c.json([])

  return c.json(
    await db.all(
      `SELECT * FROM units
       WHERE tenant_id = @t AND active = 1 AND id IN (${db.idList(user.unitIds)})
       ORDER BY name`,
      { t: user.tenantId }
    )
  )
})

const loadUnit = async (c) =>
  c.get('db').get('SELECT * FROM units WHERE id = @id AND tenant_id = @t', {
    id: c.req.param('unit_id'),
    t: c.get('user').tenantId,
  })

units.get('/:unit_id', requirePermission('unit.view'), requireUnitAccess(), async (c) => {
  const unit = await loadUnit(c)
  if (!unit) throw fail(404, 'Unit not found')
  return c.json(unit)
})

units.post('/', requirePermission('unit.manage'), validateBody(unitSchema), async (c) => {
  const db = c.get('db')
  const body = c.get('body')

  const clash = await db.get('SELECT id FROM units WHERE tenant_id = @t AND code = @c', {
    t: c.get('user').tenantId,
    c: body.code,
  })
  if (clash) throw fail(409, `Unit code "${body.code}" already exists`)

  const { id } = await db.insert(
    `INSERT INTO units (tenant_id, name, code, location, timezone)
     VALUES (@tenant_id, @name, @code, @location, @timezone)`,
    { ...body, tenant_id: c.get('user').tenantId }
  )
  return c.json(await db.get('SELECT * FROM units WHERE id = @id', { id }), 201)
})

units.patch('/:unit_id', requirePermission('unit.manage'), validateBody(unitSchema.partial()), async (c) => {
  const db = c.get('db')
  const unit = await loadUnit(c)
  if (!unit) throw fail(404, 'Unit not found')

  const next = { ...unit, ...c.get('body') }
  await db.run(
    'UPDATE units SET name = @name, code = @code, location = @location, timezone = @timezone WHERE id = @id',
    { name: next.name, code: next.code, location: next.location, timezone: next.timezone, id: unit.id }
  )
  return c.json(await db.get('SELECT * FROM units WHERE id = @id', { id: unit.id }))
})

/** Deactivate rather than delete: inspection history must keep pointing at a real unit. */
units.delete('/:unit_id', requirePermission('unit.manage'), async (c) => {
  const unit = await loadUnit(c)
  if (!unit) throw fail(404, 'Unit not found')
  await c.get('db').run('UPDATE units SET active = 0 WHERE id = @id', { id: unit.id })
  return c.body(null, 204)
})

export default units
