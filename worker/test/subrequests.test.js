import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'
import { installFakeGoogle, restoreFetch, DRIVE_ENV } from './fake-google.js'
import { createDb } from '../src/db.js'
import { readConfig } from '../src/config.js'
import { purgePhotos, archiveNotes, pruneLoginAttempts, MAX_PHOTOS_PER_RUN } from '../src/services/retention.js'
import { rebuildMonthlySheets } from '../src/services/monthlySheet.js'
import { sendOverdueDigest } from '../src/services/digest.js'

/**
 * Subrequest budget.
 *
 * A Worker on the free plan may make 50 subrequests per request, and every D1
 * query counts as one. This is not a performance preference: go over and the
 * request fails outright. The checklist install originally took about 140 and
 * would never have worked in production, so the budget is now a test.
 */
const FREE_PLAN_SUBREQUEST_LIMIT = 50

/** Count D1 calls by wrapping the binding the app is handed. */
function counting(d1) {
  const counts = { total: 0 }
  return {
    counts,
    binding: {
      prepare(sql) {
        const statement = d1.prepare(sql)
        const wrap = (method) => async (...args) => {
          counts.total += 1
          return statement[method](...args)
        }
        return {
          bind: (...params) => {
            statement.bind(...params)
            return {
              first: wrap('first'),
              all: wrap('all'),
              run: wrap('run'),
              prepared: () => statement.prepared(),
              get params() {
                return statement.params
              },
              bound: () => statement.bound(),
            }
          },
          first: wrap('first'),
          all: wrap('all'),
          run: wrap('run'),
          prepared: () => statement.prepared(),
          get params() {
            return statement.params
          },
          bound: () => statement.bound(),
        }
      },
      // A batch is one API call however many statements it carries.
      batch: async (statements) => {
        counts.total += 1
        return d1.batch(statements)
      },
      exec: (sql) => d1.exec(sql),
    },
  }
}

/**
 * The limit is per request, not per task, so the number that matters is the
 * worst single request - not the total for a sequence of them. The counter is
 * reset around each call and the peak is what gets asserted. Work the fixture
 * does directly against the database is not an HTTP request and is ignored.
 */
async function measure(fn) {
  const harness = await createHarness()
  const { counts, binding } = counting(harness.d1)
  harness.bindings.DB = binding

  let peak = 0
  let peakRequest = ''
  const call = async (path, options) => {
    counts.total = 0
    const res = await harness.call(path, options)
    if (counts.total > peak) {
      peak = counts.total
      peakRequest = `${options?.method || 'GET'} ${path}`
    }
    return res
  }

  await fn({ ...harness, call })
  return { peak, peakRequest }
}

test('installing the checklist stays inside the subrequest budget', async () => {
  const { peak, peakRequest } = await measure(async ({ call }) => {
    await call('/setup', {
      method: 'POST',
      body: {
        organisation: 'Gate Gourmet Montreal',
        slug: 'yul',
        admin_email: 'a@example.com',
        admin_name: 'Omni Administrator',
        unit_name: 'Montreal Catering Unit',
        unit_code: 'YUL',
      },
    })
    const res = await call('/setup/checklist', { method: 'POST' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
  })

  assert.ok(
    peak < FREE_PLAN_SUBREQUEST_LIMIT,
    `${peakRequest} used ${peak} subrequests, the free-plan limit is ${FREE_PLAN_SUBREQUEST_LIMIT}`
  )
})

test('signing in stays well inside the budget', async () => {
  const { peak, peakRequest } = await measure(async ({ db, call }) => {
    await seedFixture(db)
    await signIn(call, 'lhr.inspector', 'inspector-password')
  })
  assert.ok(peak < 20, `${peakRequest} used ${peak} subrequests`)
})

test('every request in the inspection flow stays inside the budget', async () => {
  const { peak, peakRequest } = await measure(async ({ db, call }) => {
    const fixture = await seedFixture(db)
    const token = await signIn(call, 'lhr.inspector', 'inspector-password')
    const draft = (
      await call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
    ).body
    const item = draft.sections[0].items[0]
    await call(`/inspections/${draft.id}`, {
      method: 'PATCH',
      token,
      body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door' }] },
    })
    await signInspection(call, token, draft.id)
    const done = await call(`/inspections/${draft.id}/submit`, { method: 'POST', token })
    assert.equal(done.status, 200)
  })

  assert.ok(
    peak < FREE_PLAN_SUBREQUEST_LIMIT,
    `${peakRequest} used ${peak} subrequests, the free-plan limit is ${FREE_PLAN_SUBREQUEST_LIMIT}`
  )
})

test('the worst request in the whole flow is reported, so regressions are visible', async () => {
  const { peak, peakRequest } = await measure(async ({ db, call }) => {
    const fixture = await seedFixture(db)
    const token = await signIn(call, 'omni', 'admin-password')

    // The heaviest reads in the app: the full template, and an inspection
    // resolved against it.
    await call(`/units/${fixture.unitA}/template`, { token })
    await call(`/units/${fixture.unitA}/template/library`, { token })
    const draft = (
      await call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
    ).body
    await call(`/inspections/${draft.id}`, { token })
    await call('/inspections', { token })

    // And opening a brand-new unit's first draft, which copies the whole
    // library into a template.
    const { id: freshUnit } = await db.insert(
      "INSERT INTO units (tenant_id, name, code) VALUES (@t, 'Fresh', 'FRSH')",
      { t: fixture.tenantId }
    )
    await call(`/units/${freshUnit}/template/draft`, { method: 'POST', token })
  })

  console.log(`    heaviest request: ${peakRequest} at ${peak} subrequests`)
  assert.ok(peak < FREE_PLAN_SUBREQUEST_LIMIT, `${peakRequest} used ${peak} subrequests`)
})

/**
 * The nightly cron is one invocation, so the purge and the sheet rebuild share
 * a single 50-subrequest budget. This is the test that keeps them honest about
 * it: raise either cap without lowering the other and this fails here rather
 * than at 03:10 in production, where a blown budget means the run does nothing
 * at all.
 */
test('the nightly cron fits in one invocation', async () => {
  const state = installFakeGoogle()
  const harness = await createHarness({ env: DRIVE_ENV })
  const fixture = await seedFixture(harness.db)
  const config = readConfig(harness.bindings)

  // A full night's worth of purgeable photos, so the purge spends its cap.
  const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const token = await signIn(harness.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await harness.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body
  for (let i = 0; i < MAX_PHOTOS_PER_RUN + 5; i += 1) {
    await harness.db.insert(
      `INSERT INTO attachments (entity_type, entity_id, filename, mime_type, size_bytes,
                                storage, storage_ref, created_at)
       VALUES ('inspection', @e, @name, 'image/jpeg', 3, 'gdrive', @ref, @at)`,
      { e: draft.id, name: `old-${i}.jpg`, ref: `drive-file-${i}`, at: old }
    )
  }

  // Count from here: everything above is fixture work, not the cron.
  const { counts, binding } = counting(harness.d1)
  const db = createDb(binding)
  let drive = 0
  const inner = globalThis.fetch
  globalThis.fetch = (...args) => {
    drive += 1
    return inner(...args)
  }

  try {
    await purgePhotos(harness.bindings, config, db)
    await archiveNotes(db)
    await pruneLoginAttempts(db, config.login.windowMinutes)
    await rebuildMonthlySheets(harness.bindings, config, db)
  } finally {
    globalThis.fetch = inner
    restoreFetch()
  }

  const total = counts.total + drive
  console.log(`    nightly cron: ${counts.total} database + ${drive} outbound = ${total} subrequests`)
  assert.ok(state.files.size > 0, 'the run should actually have written a sheet')
  assert.ok(
    total < FREE_PLAN_SUBREQUEST_LIMIT,
    `the cron used ${total} subrequests, the free-plan limit is ${FREE_PLAN_SUBREQUEST_LIMIT}`
  )
})

/**
 * Sending a report is the heaviest request in the app: it resolves the whole
 * inspection, fetches every photograph back out of Drive, renders the PDF and
 * calls Brevo. The PDF reuses the bytes the compiler already has, so it should
 * add nothing to this count - and that is what this asserts.
 */
test('sending a report with several photos stays inside the budget', async () => {
  const state = installFakeGoogle()
  const harness = await createHarness({
    env: { ...DRIVE_ENV, BREVO_ENABLED: 'true', BREVO_API_KEY: 'fake', BREVO_SENDER_EMAIL: 'r@example.com' },
  })
  const fixture = await seedFixture(harness.db)
  const token = await signIn(harness.call, 'lhr.inspector', 'inspector-password')
  const omni = await signIn(harness.call, 'omni', 'admin-password')
  await harness.call(`/units/${fixture.unitA}/recipients`, {
    method: 'POST',
    token: omni,
    body: { email: 'station@example.com' },
  })

  const draft = (
    await harness.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body
  const item = draft.sections[0].items[0]
  await harness.call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door' }] },
  })

  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0)
  )
  for (let i = 0; i < 8; i += 1) {
    const form = new FormData()
    form.set('file', new File([png], `item-${item.id}-photo-${i}.jpg`, { type: 'image/jpeg' }))
    form.set('entity_type', 'inspection')
    form.set('entity_id', String(draft.id))
    await harness.call('/attachments', { method: 'POST', token, form })
  }
  await signInspection(harness.call, token, draft.id)
  await harness.call(`/inspections/${draft.id}/submit`, { method: 'POST', token })

  // Count only the send itself.
  const { counts, binding } = counting(harness.d1)
  harness.bindings.DB = binding
  let outbound = 0
  const inner = globalThis.fetch
  globalThis.fetch = (...args) => {
    outbound += 1
    return inner(...args)
  }

  let res
  try {
    res = await harness.call(`/inspections/${draft.id}/report`, { method: 'POST', token, body: {} })
  } finally {
    globalThis.fetch = inner
    restoreFetch()
  }

  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.photos.attached, 8)
  assert.ok(state.sentEmails.length === 1)

  const total = counts.total + outbound
  console.log(`    sending a report with 8 photos: ${counts.total} database + ${outbound} outbound = ${total}`)
  assert.ok(total < FREE_PLAN_SUBREQUEST_LIMIT, `sending used ${total} subrequests`)
})

/**
 * The digest runs on its own cron trigger, so it gets its own 50 subrequests -
 * but each message costs two of them (the send, and the row in email_log), so
 * the cap on how many go out in a run is a platform limit rather than a
 * preference. This is the test that keeps those two numbers in step.
 */
test('the morning digest fits in one invocation', async () => {
  const state = installFakeGoogle()
  const harness = await createHarness({
    env: { BREVO_ENABLED: 'true', BREVO_API_KEY: 'fake', BREVO_SENDER_EMAIL: 'r@example.com' },
  })
  const fixture = await seedFixture(harness.db)
  await harness.db.run("UPDATE users SET email = username || '@example.com'")
  const manager = await signIn(harness.call, 'lhr.manager', 'manager-password')

  // Far more owners than a run will write to, so the cap is what is measured.
  for (let i = 0; i < 40; i += 1) {
    const { id } = await harness.db.insert(
      `INSERT INTO users (tenant_id, username, email, full_name, role, password_hash, must_change_password)
       VALUES (@t, @u, @e, @n, 'inspector', 'x', 0)`,
      { t: fixture.tenantId, u: `owner${i}`, e: `owner${i}@example.com`, n: `Owner ${i}` }
    )
    await harness.db.run('INSERT INTO user_units (user_id, unit_id) VALUES (@u, @unit)', {
      u: id,
      unit: fixture.unitA,
    })
    await harness.call('/capas', {
      method: 'POST',
      token: manager,
      body: {
        unit_id: fixture.unitA,
        title: `Action ${i}`,
        owner_id: id,
        due_date: new Date(Date.now() - (i + 1) * 86_400_000).toISOString().slice(0, 10),
      },
    })
  }

  // Count from here: everything above is fixture work.
  const { counts, binding } = counting(harness.d1)
  const db = createDb(binding)
  let outbound = 0
  const inner = globalThis.fetch
  globalThis.fetch = (...args) => {
    outbound += 1
    return inner(...args)
  }

  let report
  try {
    report = await sendOverdueDigest(db, readConfig(harness.bindings))
  } finally {
    globalThis.fetch = inner
    restoreFetch()
  }

  const total = counts.total + outbound
  console.log(`    morning digest: ${counts.total} database + ${outbound} outbound = ${total} subrequests`)
  assert.ok(report.sent > 0 && report.capped > 0, 'the run should be capped, which is the case being measured')
  assert.equal(state.sentEmails.length, report.sent)
  assert.ok(
    total < FREE_PLAN_SUBREQUEST_LIMIT,
    `the digest used ${total} subrequests, the free-plan limit is ${FREE_PLAN_SUBREQUEST_LIMIT}`
  )
})
