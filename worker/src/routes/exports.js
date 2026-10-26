import { Hono } from 'hono'
import { z } from 'zod'
import { validateBody } from '../middleware/validate.js'
import { requirePermission } from '../middleware/auth.js'
import { fail } from '../middleware/errors.js'
import { canAccessUnit } from '../services/permissions.js'
import { buildMonthlySheet, collectRows, monthKey, toCsv } from '../services/monthlySheet.js'

/**
 * The month's inspections as a spreadsheet.
 *
 * Two ways out, because people want two different things. A download answers
 * "send me the figures now" without anyone touching Drive. The rebuild answers
 * "the sheet in Drive is stale, I added an inspection since last night" - it is
 * the same build the cron runs, just on demand.
 */
const exports_ = new Hono()

const period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10')
  .optional()

function scopedUnit(c) {
  const unitId = Number(c.req.param('unit_id'))
  if (!Number.isInteger(unitId) || !canAccessUnit(c.get('user'), unitId)) {
    throw fail(404, 'Unit not found')
  }
  return unitId
}

exports_.get('/monthly.csv', requirePermission('report.export'), async (c) => {
  const unitId = scopedUnit(c)
  const parsed = period.safeParse(c.req.query('period') || undefined)
  if (!parsed.success) throw fail(422, 'Use a month like 2026-10')
  const month = parsed.data || monthKey()

  const rows = await collectRows(c.get('db'), unitId, month)
  return new Response(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="inspections-${month}.csv"`,
    },
  })
})

/** Where this month's sheet is, if one has been built. */
exports_.get('/monthly-sheet', requirePermission('report.view'), async (c) => {
  const unitId = scopedUnit(c)
  const parsed = period.safeParse(c.req.query('period') || undefined)
  if (!parsed.success) throw fail(422, 'Use a month like 2026-10')
  const month = parsed.data || monthKey()

  const row = await c.get('db').get(
    'SELECT file_id, web_view_link, row_count, built_at FROM unit_month_exports WHERE unit_id = @u AND period = @p',
    { u: unitId, p: month }
  )
  // Not an error when there is none: a month nobody has inspected yet simply
  // has no sheet, and the screen should say that rather than show a failure.
  return c.json({ period: month, built: Boolean(row), ...(row || {}) })
})

const rebuildSchema = z.object({ period })

exports_.post('/monthly-sheet', requirePermission('report.export'), validateBody(rebuildSchema), async (c) => {
  const unitId = scopedUnit(c)
  const config = c.get('config')

  if (config.storage.backend !== 'drive') {
    throw fail(409, 'The monthly sheet goes to Google Drive, which is not configured. See /api/health.')
  }

  const result = await buildMonthlySheet(c.env, config, c.get('db'), {
    unitId,
    period: c.get('body').period || monthKey(),
  })
  return c.json(result)
})

export default exports_
