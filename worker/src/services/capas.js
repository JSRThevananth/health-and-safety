import { now, today } from '../db.js'

/**
 * Corrective actions.
 *
 * The link back to the finding is the template item, not the inspection item
 * row: an inspector can revise their own draft, and a rating that gets edited
 * must not take the corrective action's provenance with it. The inspection id
 * is kept alongside, so "raised from the 10 October walk, against this
 * checklist line" survives either way.
 */

export const PRIORITIES = ['low', 'normal', 'high']
export const STATUSES = ['open', 'done', 'cancelled']

/** A critical finding is high priority by default; everything else is normal. */
export const priorityForRating = (rating) => (rating === 'critical' ? 'high' : 'normal')

/**
 * How long an action gets by default, in days, by priority.
 *
 * A due date everyone ignores is worse than none, so these are deliberately
 * short: a high-priority corrective action in a food unit is a this-week
 * problem, not a this-quarter one. Whoever raises it can always change it.
 */
const DEFAULT_DAYS = { high: 3, normal: 14, low: 30 }

export const defaultDueDate = (priority, from = new Date()) =>
  new Date(from.getTime() + (DEFAULT_DAYS[priority] ?? 14) * 86_400_000).toISOString().slice(0, 10)

export const isOverdue = (capa, on = today()) =>
  capa.status === 'open' && Boolean(capa.due_date) && capa.due_date < on

/** The row, plus the names a screen needs and the overdue flag it would derive. */
const SELECT = `
  SELECT c.*,
         u.name       AS unit_name,
         u.code       AS unit_code,
         owner.full_name  AS owner_name,
         owner.username   AS owner_username,
         raiser.full_name AS raised_by_name,
         closer.full_name AS closed_by_name
    FROM capas c
    JOIN units u ON u.id = c.unit_id
    LEFT JOIN users owner  ON owner.id  = c.owner_id
    LEFT JOIN users raiser ON raiser.id = c.raised_by
    LEFT JOIN users closer ON closer.id = c.closed_by`

const decorate = (row) => row && { ...row, overdue: isOverdue(row) }

export async function getCapa(db, id) {
  return decorate(await db.get(`${SELECT} WHERE c.id = @id`, { id }))
}

/**
 * List actions, scoped to units the caller can reach.
 *
 * `unitIds` null means an omni admin, who sees the whole tenant. Everyone else
 * gets an explicit list, and an empty list returns nothing rather than
 * everything - the failure mode of a scoping bug should be seeing too little.
 */
export async function listCapas(db, { unitIds, unitId = null, status = null, ownerId = null, limit = 200 }) {
  const where = []
  const params = { limit }

  if (unitIds !== null) {
    if (unitIds.length === 0) return []
    where.push(`c.unit_id IN (${db.idList(unitIds)})`)
  }
  if (unitId) {
    where.push('c.unit_id = @unit')
    params.unit = unitId
  }
  if (status) {
    where.push('c.status = @status')
    params.status = status
  }
  if (ownerId) {
    where.push('c.owner_id = @owner')
    params.owner = ownerId
  }

  const rows = await db.all(
    `${SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY
       -- Open first, then the ones with a deadline, soonest at the top: the
       -- list is a worklist, so it should be in the order the work is due.
       CASE c.status WHEN 'open' THEN 0 ELSE 1 END,
       c.due_date IS NULL,
       c.due_date,
       c.id DESC
     LIMIT @limit`,
    params
  )
  return rows.map(decorate)
}

export async function capaEvents(db, capaId) {
  return db.all(
    `SELECT e.*, u.full_name AS actor_name
       FROM capa_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.capa_id = @id
      ORDER BY e.at, e.id`,
    { id: capaId }
  )
}

export async function raiseCapa(db, { unitId, actorId, title, detail = '', priority = 'normal', ownerId = null, dueDate = null, inspectionId = null, templateItemId = null }) {
  const at = now()
  const { id } = await db.insert(
    `INSERT INTO capas (unit_id, inspection_id, template_item_id, title, detail, priority,
                        owner_id, due_date, raised_by, created_at, updated_at)
     VALUES (@unit, @inspection, @item, @title, @detail, @priority, @owner, @due, @by, @at, @at)`,
    {
      unit: unitId,
      inspection: inspectionId,
      item: templateItemId,
      title,
      detail,
      priority,
      owner: ownerId,
      due: dueDate ?? defaultDueDate(priority),
      by: actorId,
      at,
    }
  )

  await db.run(
    `INSERT INTO capa_events (capa_id, kind, detail, actor_id, at) VALUES (@id, 'raised', @detail, @by, @at)`,
    { id, detail: inspectionId ? `From inspection #${inspectionId}` : 'Raised directly', by: actorId, at }
  )
  return getCapa(db, id)
}

/**
 * Change an open action. Returns the fields that actually changed, so the
 * history records "due date moved" rather than a save with nothing in it.
 */
export async function updateCapa(db, capa, actorId, changes) {
  const sets = []
  const params = { id: capa.id, at: now() }
  const described = []

  const apply = (column, value, label, format = (v) => v) => {
    if (value === undefined || value === null) return
    if (String(capa[column] ?? '') === String(value)) return
    sets.push(`${column} = @${column}`)
    params[column] = value
    described.push(`${label}: ${format(capa[column]) || 'none'} -> ${format(value)}`)
  }

  apply('title', changes.title, 'Title')
  apply('detail', changes.detail, 'Detail')
  apply('priority', changes.priority, 'Priority')
  apply('owner_id', changes.owner_id, 'Owner', (v) => (v ? `#${v}` : 'unassigned'))
  apply('due_date', changes.due_date, 'Due')

  if (sets.length === 0) return { changed: false, capa }

  await db.batch([
    db.stmt(`UPDATE capas SET ${sets.join(', ')}, updated_at = @at WHERE id = @id`, params),
    db.stmt(
      `INSERT INTO capa_events (capa_id, kind, detail, actor_id, at)
       VALUES (@id, @kind, @detail, @by, @at)`,
      {
        id: capa.id,
        kind: changes.owner_id !== undefined && changes.owner_id !== null ? 'assigned' : 'updated',
        detail: described.join('; '),
        by: actorId,
        at: params.at,
      }
    ),
  ])

  return { changed: true, capa: await getCapa(db, capa.id) }
}

/**
 * Close an action, or cancel it.
 *
 * A closing note is required rather than optional. "Done" with nothing behind
 * it is the state this whole table exists to avoid: an auditor asking what was
 * actually done should not be answered with a tick.
 */
export async function closeCapa(db, capa, actorId, { status = 'done', note }) {
  const at = now()
  await db.batch([
    db.stmt(
      `UPDATE capas SET status = @status, closed_at = @at, closed_by = @by,
                        closing_note = @note, updated_at = @at
        WHERE id = @id`,
      { status, at, by: actorId, note, id: capa.id }
    ),
    db.stmt(
      `INSERT INTO capa_events (capa_id, kind, detail, actor_id, at)
       VALUES (@id, @kind, @note, @by, @at)`,
      { id: capa.id, kind: status === 'cancelled' ? 'cancelled' : 'closed', note, by: actorId, at }
    ),
  ])
  return getCapa(db, capa.id)
}

/** Put a closed action back into the worklist, with a reason. */
export async function reopenCapa(db, capa, actorId, reason) {
  const at = now()
  await db.batch([
    db.stmt(
      `UPDATE capas SET status = 'open', closed_at = NULL, closed_by = NULL,
                        closing_note = '', updated_at = @at
        WHERE id = @id`,
      { at, id: capa.id }
    ),
    db.stmt(
      `INSERT INTO capa_events (capa_id, kind, detail, actor_id, at)
       VALUES (@id, 'reopened', @detail, @by, @at)`,
      { id: capa.id, detail: reason, by: actorId, at }
    ),
  ])
  return getCapa(db, capa.id)
}

/** Open, overdue and due-this-week, for the dashboard. */
export async function capaSummary(db, unitIds) {
  const scope = unitIds === null ? '' : `AND unit_id IN (${db.idList(unitIds)})`
  if (unitIds !== null && unitIds.length === 0) return { open: 0, overdue: 0, due_soon: 0, high: 0 }

  const week = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  return db.get(
    `SELECT COUNT(*) AS open,
            SUM(CASE WHEN due_date IS NOT NULL AND due_date < @today THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN due_date IS NOT NULL AND due_date >= @today AND due_date <= @week THEN 1 ELSE 0 END) AS due_soon,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) AS high
       FROM capas
      WHERE status = 'open' ${scope}`,
    { today: today(), week }
  )
}
