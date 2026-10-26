import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, seedFixture, signIn, signInspection, SIGNATURE_IMAGE } from './helpers.js'
import { installFakeGoogle, restoreFetch, DRIVE_ENV } from './fake-google.js'

afterEach(restoreFetch)

async function onShift() {
  const h = await createHarness()
  const fixture = await seedFixture(h.db)
  const token = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body
  return { ...h, ...fixture, token, draft }
}

/** Describe a finding, so the only thing standing between here and submit is the signature. */
async function recordFinding({ call, token, draft }) {
  const item = draft.sections[0].items[0]
  await call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })
  return item
}

test('an unsigned inspection cannot be submitted', async () => {
  const h = await onShift()
  await recordFinding(h)

  const res = await h.call(`/inspections/${h.draft.id}/submit`, { method: 'POST', token: h.token })
  assert.equal(res.status, 422)
  assert.equal(res.body.code, 'SIGNATURE_REQUIRED')
})

test('the signature requirement is reported before the description one', async () => {
  const h = await onShift()
  const item = h.draft.sections[0].items[0]
  // A finding with no description AND no signature: both are wrong.
  await h.call(`/inspections/${h.draft.id}`, {
    method: 'PATCH',
    token: h.token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: '' }] },
  })

  // Asking for the signature first means the inspector is not sent away to fix
  // descriptions only to be stopped again at the pad.
  const res = await h.call(`/inspections/${h.draft.id}/submit`, { method: 'POST', token: h.token })
  assert.equal(res.body.code, 'SIGNATURE_REQUIRED')
})

test('signing then submitting works, and the signature is on the record', async () => {
  const h = await onShift()
  await recordFinding(h)

  const signed = await signInspection(h.call, h.token, h.draft.id, 'Ayesha Rahman')
  assert.equal(signed.signatures.length, 1)
  assert.equal(signed.signatures[0].role, 'inspector')
  assert.equal(signed.signatures[0].signed_name, 'Ayesha Rahman')
  assert.ok(signed.signatures[0].signed_at)

  const submitted = await h.call(`/inspections/${h.draft.id}/submit`, { method: 'POST', token: h.token })
  assert.equal(submitted.status, 200)
  assert.equal(submitted.body.signatures[0].signed_name, 'Ayesha Rahman')
})

test('a supervisor countersignature is captured alongside the inspector’s', async () => {
  const h = await onShift()
  await recordFinding(h)
  await signInspection(h.call, h.token, h.draft.id, 'Ayesha Rahman')

  const counter = await h.call(`/inspections/${h.draft.id}/signature`, {
    method: 'POST',
    token: h.token,
    body: { role: 'supervisor', name: 'Marc Tremblay', image: SIGNATURE_IMAGE },
  })
  assert.equal(counter.status, 201)
  assert.deepEqual(
    counter.body.signatures.map((s) => [s.role, s.signed_name]),
    [
      ['inspector', 'Ayesha Rahman'],
      ['supervisor', 'Marc Tremblay'],
    ]
  )
})

test('re-signing replaces rather than stacking up', async () => {
  const h = await onShift()
  await signInspection(h.call, h.token, h.draft.id, 'First Attempt')
  const again = await signInspection(h.call, h.token, h.draft.id, 'Ayesha Rahman')

  assert.equal(again.signatures.length, 1)
  assert.equal(again.signatures[0].signed_name, 'Ayesha Rahman')
})

test('a signature can be cleared while the inspection is still open', async () => {
  const h = await onShift()
  await recordFinding(h)
  await signInspection(h.call, h.token, h.draft.id)

  const cleared = await h.call(`/inspections/${h.draft.id}/signature/inspector`, {
    method: 'DELETE',
    token: h.token,
  })
  assert.equal(cleared.status, 204)

  const res = await h.call(`/inspections/${h.draft.id}/submit`, { method: 'POST', token: h.token })
  assert.equal(res.body.code, 'SIGNATURE_REQUIRED')
})

test('a submitted inspection cannot be signed again', async () => {
  const h = await onShift()
  await recordFinding(h)
  await signInspection(h.call, h.token, h.draft.id)
  await h.call(`/inspections/${h.draft.id}/submit`, { method: 'POST', token: h.token })

  const res = await h.call(`/inspections/${h.draft.id}/signature`, {
    method: 'POST',
    token: h.token,
    body: { role: 'supervisor', name: 'Too Late', image: SIGNATURE_IMAGE },
  })
  assert.equal(res.status, 409)
})

test('one inspector cannot sign another’s inspection', async () => {
  const h = await onShift()
  const manager = await signIn(h.call, 'lhr.manager', 'manager-password')

  const res = await h.call(`/inspections/${h.draft.id}/signature`, {
    method: 'POST',
    token: manager,
    body: { role: 'inspector', name: 'Not Me', image: SIGNATURE_IMAGE },
  })
  assert.equal(res.status, 403)
})

test('anything that is not a small image is refused', async () => {
  const h = await onShift()

  const bad = [
    ['markup', '<script>alert(1)</script>'],
    ['a remote url', 'https://example.com/signature.png'],
    ['an svg data url', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['an empty drawing', 'data:image/png;base64,iVBORw0KGgo='],
  ]

  for (const [why, image] of bad) {
    const res = await h.call(`/inspections/${h.draft.id}/signature`, {
      method: 'POST',
      token: h.token,
      body: { role: 'inspector', name: 'Someone', image },
    })
    assert.equal(res.status, 422, `${why} should be refused`)
  }
})

test('a signature larger than the cap is refused', async () => {
  const h = await onShift()
  // 400 KB of base64: a photograph, not a drawing.
  const huge = `data:image/png;base64,${'A'.repeat(400 * 1024)}`

  const res = await h.call(`/inspections/${h.draft.id}/signature`, {
    method: 'POST',
    token: h.token,
    body: { role: 'inspector', name: 'Someone', image: huge },
  })
  assert.equal(res.status, 422)
  assert.match(res.body.error, /too large/)
})

test('signatures survive in the record and reach the report', async () => {
  installFakeGoogle()
  const h = await createHarness({ env: DRIVE_ENV })
  const fixture = await seedFixture(h.db)
  const token = await signIn(h.call, 'lhr.inspector', 'inspector-password')
  const draft = (
    await h.call('/inspections/draft', { method: 'POST', token, body: { unit_id: fixture.unitA } })
  ).body

  const item = draft.sections[0].items[0]
  await h.call(`/inspections/${draft.id}`, {
    method: 'PATCH',
    token,
    body: { items: [{ template_item_id: item.id, rating: 'critical', note: 'Fire door wedged open' }] },
  })
  await signInspection(h.call, token, draft.id, 'Ayesha Rahman')
  await h.call(`/inspections/${draft.id}/signature`, {
    method: 'POST',
    token,
    body: { role: 'supervisor', name: 'Marc Tremblay', image: SIGNATURE_IMAGE },
  })
  await h.call(`/inspections/${draft.id}/submit`, { method: 'POST', token })

  const preview = await h.call(`/inspections/${draft.id}/report/preview`, { token })
  assert.match(preview.body.html, /Ayesha Rahman/)
  assert.match(preview.body.html, /Marc Tremblay/)
  // The drawing itself is inline, not a link: it must render even years later,
  // when the photos from the same inspection have long been purged.
  assert.match(preview.body.html, /src="data:image\/png;base64,/)
  assert.match(preview.body.text, /Signed by Ayesha Rahman/)
})
