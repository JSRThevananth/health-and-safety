import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection } from './helpers.js'
import { installFakeGoogle, restoreFetch, DRIVE_ENV } from './fake-google.js'
import { MAX_PHOTO_FETCHES } from '../src/services/reports.js'

afterEach(restoreFetch)

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

/** An inspection on Drive-backed storage, with one critical finding recorded. */
async function withSubmittedInspection({ google = {}, env = {} } = {}) {
  const state = installFakeGoogle(google)
  const h = await createHarness({ env: { ...DRIVE_ENV, ...env } })
  const fixture = await seedFixture(h.db)

  const inspector = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token: inspector, body: { unit_id: fixture.unitA } })
  ).body
  const item = draft.sections[0].items[0]

  await h.call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token: inspector,
    body: {
      department: 'Hot Kitchen',
      items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open with a crate' }],
    },
  })

  const photo = await upload(h.call, inspector, draft.id, `item-${item.id}-door.jpg`)

  await signInspection(h.call, inspector, draft.id, 'LHR Inspector')
  await h.call(`/inspections/${draft.id}/submit`, { method: 'POST', token: inspector })
  return { ...h, ...fixture, state, inspector, draft, item, photo }
}

async function upload(call, token, inspectionId, name) {
  const form = new FormData()
  form.set('file', new File([PNG], name, { type: 'image/jpeg' }))
  form.set('entity_type', 'inspection')
  form.set('entity_id', String(inspectionId))
  const res = await call('/attachments', { method: 'POST', token, form })
  assert.equal(res.status, 201, `upload failed: ${JSON.stringify(res.body)}`)
  return res.body
}

async function addRecipient(call, token, unitId, email, extra = {}) {
  const res = await call(`/units/${unitId}/recipients`, {
    method: 'POST',
    token,
    body: { email, ...extra },
  })
  assert.ok(res.status < 300, `adding ${email} failed: ${JSON.stringify(res.body)}`)
  return res.body
}

/* -------------------------------------------------------------- storage -- */

test('a photo is uploaded to Drive as the account owner', async () => {
  const { state, photo } = await withSubmittedInspection()

  assert.equal(photo.storage, 'gdrive')
  assert.equal(state.files.size, 1)
  assert.ok(state.files.has(photo.storage_ref))
  assert.match(photo.web_view_link, /drive\.google\.com/)
  // One token exchange, reused for the life of the isolate.
  assert.equal(state.tokenExchanges, 1)
})

test('a Drive credential that Google rejects fails the upload with Google’s own reason', async () => {
  installFakeGoogle()
  const { db, call } = await createHarness({
    env: { ...DRIVE_ENV, GDRIVE_REFRESH_TOKEN: 'expired' },
  })
  const fixture = await seedFixture(db)
  const token = await signIn(call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body

  const form = new FormData()
  form.set('file', new File([PNG], 'x.jpg', { type: 'image/jpeg' }))
  form.set('entity_type', 'inspection')
  form.set('entity_id', String(draft.id))
  const res = await call('/attachments', { method: 'POST', token, form })

  assert.equal(res.status, 500)
})

test('health names what a Drive deployment is still missing', async () => {
  const { call } = await createHarness({ env: { STORAGE_BACKEND: 'drive' } })
  const res = await call('/health')

  assert.equal(res.status, 503)
  const problems = res.body.problems.join(' ')
  assert.match(problems, /GDRIVE_CLIENT_ID/)
  assert.match(problems, /GDRIVE_FOLDER_ID/)
})

/* ----------------------------------------------------------- recipients -- */

test('recipients belong to a unit, and one unit never sees another’s', async () => {
  const { call, unitA, unitB } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')

  await addRecipient(call, omni, unitA, 'lhr.station@example.com')
  await addRecipient(call, omni, unitB, 'dxb.station@example.com')

  const a = await call(`/units/${unitA}/recipients`, { token: omni })
  assert.deepEqual(a.body.map((r) => r.email), ['lhr.station@example.com'])

  const b = await call(`/units/${unitB}/recipients`, { token: omni })
  assert.deepEqual(b.body.map((r) => r.email), ['dxb.station@example.com'])
})

test('an inspector cannot change who receives their unit’s reports', async () => {
  const { call, unitA, inspector } = await withSubmittedInspection()

  const res = await call(`/units/${unitA}/recipients`, {
    method: 'POST',
    token: inspector,
    body: { email: 'me@example.com' },
  })
  assert.equal(res.status, 403)
})

test('re-adding a removed recipient brings them back rather than failing', async () => {
  const { call, unitA } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')

  const added = await addRecipient(call, omni, unitA, 'station@example.com')
  await call(`/units/${unitA}/recipients/${added.id}`, { method: 'DELETE', token: omni })
  assert.equal((await call(`/units/${unitA}/recipients`, { token: omni })).body.length, 0)

  const again = await addRecipient(call, omni, unitA, 'station@example.com')
  assert.equal(again.id, added.id)
  assert.equal((await call(`/units/${unitA}/recipients`, { token: omni })).body.length, 1)
})

test('the same address cannot be added twice for the same report', async () => {
  const { call, unitA } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')
  await addRecipient(call, omni, unitA, 'station@example.com')

  const again = await call(`/units/${unitA}/recipients`, {
    method: 'POST',
    token: omni,
    body: { email: 'station@example.com' },
  })
  assert.equal(again.status, 409)
})

/* --------------------------------------------------------------- report -- */

test('the report retrieves the photo from Drive and sends it inside the PDF', async () => {
  const { call, unitA, inspector, draft } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')
  await addRecipient(call, omni, unitA, 'station@example.com')

  const res = await call(`/inspections/${draft.id}/report`, { method: 'POST', token: inspector, body: {} })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'skipped')
  assert.deepEqual(res.body.recipients, ['station@example.com'])
})

test('the report body shows the finding, its note and its photo', async () => {
  const { call, inspector, draft, photo } = await withSubmittedInspection()

  const res = await call(`/inspections/${draft.id}/report/preview`, { token: inspector })
  assert.equal(res.status, 200)

  assert.match(res.body.subject, /^LHR inspection \d{4}-\d{2}-\d{2} - 1 finding$/)
  assert.match(res.body.html, /Fire door wedged open with a crate/)
  assert.match(res.body.html, /Critical/)
  assert.match(res.body.html, /Heathrow Catering Unit/)
  // The photo is shown by a link the Worker will serve, because Brevo does not
  // support inline images.
  assert.match(res.body.html, new RegExp(`https://qa\\.example\\.workers\\.dev/api/photos/${photo.id}\\?t=`))
  assert.match(res.body.text, /\[Critical\]/)
})

test('a photo that Drive will not return is named in the report, not dropped', async () => {
  const first = await withSubmittedInspection()
  const driveId = first.photo.storage_ref
  restoreFetch()

  // The same inspection, but Drive now refuses that file.
  const { call, inspector, draft } = await withSubmittedInspection({
    google: { failDownloadFor: [driveId] },
  })

  const res = await call(`/inspections/${draft.id}/report/preview`, { token: inspector })
  const unavailable = res.body.photos.unavailable
  assert.equal(unavailable.length, 1)
  assert.match(unavailable[0].why, /could not be retrieved from Drive/)
  // And the report still went out with the finding in it.
  assert.match(res.body.html, /Fire door wedged open/)
})

test('a purged photo is reported as purged rather than as an error', async () => {
  const { db, call, inspector, draft, photo } = await withSubmittedInspection()
  await db.run(
    `UPDATE attachments SET purged_at = '2026-01-20T03:10:00Z', purge_policy = 'photo retention: 14 days'
     WHERE id = @id`,
    { id: photo.id }
  )

  const res = await call(`/inspections/${draft.id}/report/preview`, { token: inspector })
  assert.match(res.body.photos.unavailable[0].why, /purged on 2026-01-20/)
})

test('a draft cannot be reported on', async () => {
  const { call, unitA, inspector } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')
  await addRecipient(call, omni, unitA, 'station@example.com')

  const fresh = await call('/inspections/draft', {
    method: 'POST',
    token: await signIn(call, 'lhr.manager', 'manager-password'),
    body: { unit_id: unitA },
  })
  const res = await call(`/inspections/${fresh.body.id}/report`, {
    method: 'POST',
    token: omni,
    body: {},
  })
  assert.equal(res.status, 409)
})

test('sending with no recipients is refused rather than quietly succeeding', async () => {
  const { call, inspector, draft } = await withSubmittedInspection()

  const res = await call(`/inspections/${draft.id}/report`, { method: 'POST', token: inspector, body: {} })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /No recipients/)
})

test('the sender picks from the unit’s list, and defaults are pre-ticked', async () => {
  const { call, unitA, inspector, draft, state } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')

  const always = await addRecipient(call, omni, unitA, 'always@example.com')
  const sometimes = await addRecipient(call, omni, unitA, 'sometimes@example.com', {
    default_selected: false,
  })

  const offered = await call(`/inspections/${draft.id}/recipients`, { token: inspector })
  assert.deepEqual(
    offered.body.map((r) => [r.email, r.default_selected]),
    [
      ['always@example.com', true],
      ['sometimes@example.com', false],
    ]
  )

  // Sending with no choice uses the defaults...
  const sent1 = await call(`/inspections/${draft.id}/report`, { method: 'POST', token: inspector, body: {} })
  assert.deepEqual(sent1.body.recipients, ['always@example.com'])

  // ...and an explicit choice overrides them, including a one-off address.
  const sent2 = await call(`/inspections/${draft.id}/report`, {
    method: 'POST',
    token: inspector,
    body: { recipient_ids: [sometimes.id], extra_emails: ['auditor@example.com'] },
  })
  assert.deepEqual(sent2.body.recipients, ['sometimes@example.com', 'auditor@example.com'])
  assert.ok(always)
})

test('one unit’s report can never be addressed to another unit’s recipients', async () => {
  const { call, unitA, unitB, inspector, draft, state } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')

  await addRecipient(call, omni, unitA, 'lhr@example.com')
  const dxb = await addRecipient(call, omni, unitB, 'dxb@example.com')

  // Naming the other unit's recipient by id on an LHR inspection.
  const res = await call(`/inspections/${draft.id}/report`, {
    method: 'POST',
    token: inspector,
    body: { recipient_ids: [dxb.id] },
  })

  assert.equal(res.status, 422, 'the send should find no valid recipients, not fall back to DXB')
})

test('with email disabled, the report log stays empty', async () => {
  const { call, unitA, inspector, draft } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')
  await addRecipient(call, omni, unitA, 'station@example.com')

  await call(`/inspections/${draft.id}/report`, { method: 'POST', token: inspector, body: {} })

  const log = await call(`/inspections/${draft.id}/report/log`, { token: inspector })
  assert.equal(log.body.length, 0)
})

/* ---------------------------------------------------------- photo links -- */

test('a signed photo link serves the photo without a session', async () => {
  const { call, inspector, draft, photo } = await withSubmittedInspection()
  const preview = await call(`/inspections/${draft.id}/report/preview`, { token: inspector })
  const url = new RegExp(`/api/photos/${photo.id}\\?t=([^"&]+)`).exec(preview.body.html)[1]

  // No token header: this is what an email client does.
  const res = await call(`/photos/${photo.id}?t=${url}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/jpeg')
})

test('an unsigned, altered or missing photo link is refused', async () => {
  const { call, photo } = await withSubmittedInspection()

  for (const token of ['', 'nonsense', '9999999999.wrongsignature']) {
    const res = await call(`/photos/${photo.id}?t=${token}`)
    assert.equal(res.status, 403, `token "${token}" should be refused`)
  }
})

test('a photo link does not open a different photo', async () => {
  const { call, inspector, draft, photo } = await withSubmittedInspection()
  const second = await upload(call, inspector, draft.id, 'item-999-other.jpg')

  const preview = await call(`/inspections/${draft.id}/report/preview`, { token: inspector })
  const token = new RegExp(`/api/photos/${photo.id}\\?t=([^"&]+)`).exec(preview.body.html)[1]

  const res = await call(`/photos/${second.id}?t=${token}`)
  assert.equal(res.status, 403)
})

test('an expired photo link is refused', async () => {
  const { call, photo, bindings } = await withSubmittedInspection({
    env: { REPORT_PHOTO_LINK_DAYS: '0' },
  })
  const { signPhotoToken } = await import('../src/services/photoLinks.js')
  const { readConfig } = await import('../src/config.js')

  const token = await signPhotoToken(photo.id, readConfig(bindings))
  const res = await call(`/photos/${photo.id}?t=${token}`)
  assert.equal(res.status, 403)
})

test('the report can be downloaded as a PDF', async () => {
  const { call, inspector, draft } = await withSubmittedInspection()

  const res = await call(`/inspections/${draft.id}/report.pdf`, { token: inspector })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/pdf')
  // Inline, so a tap on a phone opens the viewer rather than leaving a file to
  // go and find.
  assert.match(res.headers.get('content-disposition'), /^inline; filename="LHR-inspection-\d{4}-\d{2}-\d{2}\.pdf"$/)
  assert.ok(String(res.body).startsWith('%PDF-1.4'))
})

test('a PDF of another unit\'s inspection is not downloadable', async () => {
  const { call, draft } = await withSubmittedInspection()
  const other = await signIn(call, 'dxb.inspector', 'inspector-password')

  const res = await call(`/inspections/${draft.id}/report.pdf`, { token: other })
  assert.equal(res.status, 404)
})

test('a report with more photos than the platform allows still sends', async () => {
  const { call, unitA, inspector, draft, item } = await withSubmittedInspection()
  const omni = await signIn(call, 'admin', 'admin-password')
  await addRecipient(call, omni, unitA, 'station@example.com')

  // Two past the cap. The byte budget would happily allow these - a phone
  // photo is a few hundred KB and the limit is 12 MB - so without the fetch
  // cap the request goes over 50 subrequests and the platform refuses it
  // outright, losing the whole report rather than a few of its photographs.
  for (let i = 0; i < MAX_PHOTO_FETCHES + 1; i += 1) {
    await upload(call, inspector, draft.id, `item-${item.id}-extra-${i}.jpg`)
  }

  const res = await call(`/inspections/${draft.id}/report`, { method: 'POST', token: inspector, body: {} })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.status, 'skipped')

  // Capped, not dropped: the ones left out are named with the reason, so the
  // report accounts for every photograph taken.
  assert.equal(res.body.photos.attached, MAX_PHOTO_FETCHES)
  assert.equal(res.body.photos.total, MAX_PHOTO_FETCHES + 2)
  assert.equal(res.body.photos.unavailable.length, 2)
  for (const missing of res.body.photos.unavailable) {
    assert.match(missing.why, /platform's limits/)
  }
})
