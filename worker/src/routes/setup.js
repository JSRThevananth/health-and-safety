import { Hono } from 'hono'
import { z } from 'zod'
import { hashPassword, randomId } from '../crypto.js'
import { validateBody } from '../middleware/validate.js'
import { fail } from '../middleware/errors.js'
import { installLibrary } from '../services/library.js'
import { createDraft, publishDraft, getPublishedTemplate } from '../services/formTemplates.js'

const setup = new Hono()

const setupSchema = z.object({
  organisation: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Lower-case letters, digits and hyphens only')
    .default('main'),
  admin_username: z.string().min(3).max(50).regex(/^[A-Za-z0-9._-]+$/).default('omni'),
  admin_email: z.string().email(),
  admin_name: z.string().min(1).max(120),
  unit_name: z.string().min(1).max(120),
  unit_code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
})

/**
 * First-run setup.
 *
 * Split into two requests, and resumable, because of a hard platform limit: a
 * Worker on the free plan gets 10ms of CPU per request. Doing the whole of
 * setup in one call - hash a password, insert 303 checklist items, publish a
 * template - runs past that, and the request is killed wherever it happens to
 * be. That is not hypothetical: it is how this app first failed in production,
 * leaving an organisation and a unit behind with no admin account, and a setup
 * route that then refused to run again because an organisation existed.
 *
 * So: this call creates the organisation, the unit and the admin, and nothing
 * else. The checklist is installed by /setup/checklist afterwards. Each step
 * checks what already exists rather than assuming it is starting from nothing,
 * so an interrupted setup is finished by running it again rather than needing
 * someone to go into the database.
 */
setup.post('/', validateBody(setupSchema), async (c) => {
  const db = c.get('db')
  const body = c.get('body')

  // An admin account is what "already set up" means. A tenant on its own is the
  // wreckage of an interrupted run, and the whole point is to recover from it.
  const { n: admins } = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'omni_admin'")
  if (admins > 0) {
    throw fail(409, 'This deployment is already set up. Use the admin account you created.')
  }

  const tenant =
    (await db.get('SELECT * FROM tenants WHERE slug = @slug', { slug: body.slug })) ??
    (await db.get('SELECT * FROM tenants ORDER BY id LIMIT 1'))

  const tenantId =
    tenant?.id ??
    (
      await db.insert('INSERT INTO tenants (name, slug) VALUES (@name, @slug)', {
        name: body.organisation,
        slug: body.slug,
      })
    ).id

  const unit =
    (await db.get('SELECT * FROM units WHERE tenant_id = @t AND code = @c', {
      t: tenantId,
      c: body.unit_code,
    })) ?? (await db.get('SELECT * FROM units WHERE tenant_id = @t ORDER BY id LIMIT 1', { t: tenantId }))

  const unitId =
    unit?.id ??
    (
      await db.insert('INSERT INTO units (tenant_id, name, code) VALUES (@t, @name, @code)', {
        t: tenantId,
        name: body.unit_name,
        code: body.unit_code,
      })
    ).id

  // Generated here and returned once. Never chosen by the caller, never stored
  // anywhere readable, and the account must change it at first sign-in.
  const password = `${randomId().slice(0, 6)}-${randomId().slice(0, 6)}-${randomId().slice(0, 6)}`

  await db.insert(
    `INSERT INTO users (tenant_id, username, email, full_name, initials, role, password_hash)
     VALUES (@t, @username, @email, @name, @initials, 'omni_admin', @hash)`,
    {
      t: tenantId,
      username: body.admin_username,
      email: body.admin_email,
      name: body.admin_name,
      initials: body.admin_name
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 3)
        .toUpperCase(),
      hash: await hashPassword(password),
    }
  )

  return c.json(
    {
      status: 'ok',
      organisation: tenant?.name ?? body.organisation,
      unit: { id: unitId, code: unit?.code ?? body.unit_code },
      admin: { username: body.admin_username, temporary_password: password },
      // The caller runs this next. Saying so in the response keeps the two
      // halves tied together rather than relying on the client to remember.
      next_step: 'checklist',
    },
    201
  )
})

/**
 * Install the master checklist and publish version 1 for the unit.
 *
 * A second request purely so the work fits the CPU budget. Idempotent, and
 * closed as soon as there is a published template, so it cannot be used to
 * reinstall over a unit that is in service.
 */
setup.post('/checklist', async (c) => {
  const db = c.get('db')

  const unit = await db.get('SELECT * FROM units ORDER BY id LIMIT 1')
  if (!unit) throw fail(409, 'Create the organisation first.')

  const admin = await db.get(
    "SELECT id FROM users WHERE tenant_id = @t AND role = 'omni_admin' ORDER BY id LIMIT 1",
    { t: unit.tenant_id }
  )
  if (!admin) throw fail(409, 'Create the organisation first.')

  /*
   * Idempotent rather than an error.
   *
   * This runs straight after the account is created, and it also runs when an
   * admin account is reissued against an organisation that already has its
   * checklist - a lost temporary password, say. Refusing in that case reports a
   * failure for a deployment that is in fact complete, and the page would show
   * an alarming warning next to a perfectly good password.
   */
  if (await getPublishedTemplate(db, unit.id)) {
    const { n } = await db.get(
      'SELECT COUNT(*) AS n FROM library_items i JOIN library_groups g ON g.id = i.group_id' +
        ' JOIN library_sections s ON s.id = g.section_id WHERE s.tenant_id = @t',
      { t: unit.tenant_id }
    )
    return c.json({
      status: 'ok',
      already_installed: true,
      checklist: { sections: 0, groups: 0, items: n },
      unit: { id: unit.id, code: unit.code },
    })
  }

  const installed = await installLibrary(db, unit.tenant_id)
  const draft = await createDraft(db, unit.id, unit.tenant_id, admin.id)
  const published = await publishDraft(db, draft.id)
  if (published.error) throw fail(500, `The checklist could not be published: ${published.error}`)

  return c.json({ status: 'ok', checklist: installed, unit: { id: unit.id, code: unit.code } })
})

/** What the deployment still needs. The sign-in page asks this. */
setup.get('/status', async (c) => {
  const db = c.get('db')
  const { n: admins } = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'omni_admin'")
  const unit = await db.get('SELECT * FROM units ORDER BY id LIMIT 1')
  const hasChecklist = unit ? Boolean(await getPublishedTemplate(db, unit.id)) : false

  return c.json({
    needs_setup: admins === 0,
    // Set when the organisation exists but its checklist does not - an
    // interrupted setup, which the checklist step finishes.
    needs_checklist: admins > 0 && Boolean(unit) && !hasChecklist,
  })
})

export default setup
