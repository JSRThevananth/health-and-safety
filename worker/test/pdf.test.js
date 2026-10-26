import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { createPdf, prepareImage, textWidth, wrap } from '../src/services/pdf.js'
import { dataUrlBytes, renderInspectionPdf } from '../src/services/reportPdf.js'

/**
 * The PDF writer.
 *
 * A PDF that will not open is worse than no PDF, and "it looked fine" is not a
 * test - so these check the structure a reader actually depends on: the
 * cross-reference offsets, the object graph, and that the images really are
 * embedded rather than referenced.
 */

const text = (bytes) => Buffer.from(bytes).toString('latin1')

/**
 * Walk the cross-reference table and check every offset lands on its object.
 *
 * This is the one thing that makes a PDF openable: a reader seeks to these
 * byte positions, and a file whose offsets are off by even one byte fails to
 * open in Acrobat while still looking plausible in a text editor.
 */
function checkXref(bytes) {
  const body = text(bytes)
  assert.ok(body.startsWith('%PDF-1.'), 'it should start with a PDF header')
  assert.ok(body.endsWith('%%EOF\n'), 'and end with the end-of-file marker')

  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(body)?.[1])
  assert.ok(Number.isInteger(startxref), 'startxref should name a byte offset')
  assert.equal(body.slice(startxref, startxref + 4), 'xref', 'which should point at the table')

  const table = body.slice(startxref)
  const size = Number(/\/Size (\d+)/.exec(table)?.[1])
  const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
  assert.equal(offsets.length, size - 1, 'every object but the free one should be listed')

  offsets.forEach((offset, index) => {
    assert.equal(
      body.slice(offset, offset + `${index + 1} 0 obj`.length),
      `${index + 1} 0 obj`,
      `object ${index + 1} is not at the offset the table gives`
    )
  })

  const root = Number(/\/Root (\d+) 0 R/.exec(table)?.[1])
  assert.ok(root >= 1 && root < size, 'the trailer should name a catalog that exists')
  return body
}

const pageCount = (body) => (body.match(/\/Type \/Page[^s]/g) || []).length

/* -------------------------------------------------------------- metrics -- */

test('text is measured, not guessed', () => {
  // Helvetica is proportional: the point of carrying the widths is that these
  // are not the same number.
  assert.notEqual(textWidth('iii', 10), textWidth('WWW', 10))
  assert.ok(textWidth('WWW', 10) > textWidth('iii', 10))
  // And bold is wider than regular at the same size.
  assert.ok(textWidth('Findings', 10, true) > textWidth('Findings', 10))
  assert.equal(textWidth('', 10), 0)
})

test('wrapping breaks on spaces, and inside a word only when it has to', () => {
  const lines = wrap('the quick brown fox jumps over the lazy dog', 80, 10)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(textWidth(line, 10) <= 80, `too wide: ${line}`)

  // A 60-character filename with no spaces has to run onto the next line
  // rather than off the edge of the paper.
  const long = wrap('item-1-a'.repeat(20), 80, 10)
  assert.ok(long.length > 1)
  for (const line of long) assert.ok(textWidth(line, 10) <= 80)

  // Newlines in an inspector's note are paragraph breaks, not whitespace.
  assert.equal(wrap('one\ntwo', 500, 10).length, 2)
})

/* ---------------------------------------------------------- the writer -- */

test('an empty document is still a valid PDF', () => {
  const body = checkXref(createPdf({ title: 'Empty' }).build())
  assert.equal(pageCount(body), 1)
})

test('text, rules and fields produce a readable file', () => {
  const doc = createPdf({ title: 'Report' })
  doc.text('Montreal Catering Unit', { size: 16, bold: true })
  doc.rule()
  doc.field('Inspector', 'Roy Selvarasu')
  const body = checkXref(doc.build())

  assert.match(body, /\(Montreal Catering Unit\) Tj/)
  assert.match(body, /\(Roy Selvarasu\) Tj/)
  assert.match(body, /\/BaseFont \/Helvetica-Bold/)
})

test('brackets and backslashes in a note cannot corrupt the file', () => {
  const doc = createPdf({})
  doc.text('Crate (blue) left by \\ the door')
  const body = checkXref(doc.build())
  // Unescaped, the ( would open a string the reader never sees closed.
  assert.match(body, /\(Crate \\\(blue\\\) left by \\\\ the door\) Tj/)
})

test('content longer than a page flows onto the next one', () => {
  const doc = createPdf({ footer: (page, total) => `page ${page} of ${total}` })
  for (let i = 0; i < 120; i += 1) doc.text(`Finding number ${i} on the list`)
  const body = checkXref(doc.build())

  assert.ok(pageCount(body) > 1, 'it should have paginated')
  // The footer can only be written once the last page exists.
  assert.match(body, new RegExp(`\\(page 1 of ${pageCount(body)}\\) Tj`))
})

/* ---------------------------------------------------------- the images -- */

/** A real RGBA PNG: a diagonal stroke on transparent, as a signature pad writes. */
function makePng(width = 120, height = 40, { colorType = 6, interlace = 0, depth = 8 } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const raw = Buffer.alloc((width * channels + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1)
    raw[row] = y % 5 // exercise all five row filters
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * channels
      const on = Math.abs(Math.round((x / width) * height) - y) < 3
      for (let c = 0; c < channels; c += 1) raw[at + c] = on ? 40 : 200
    }
  }
  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4)
    data.copy(out, 8)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = depth
  ihdr[9] = colorType
  ihdr[12] = interlace
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  )
}

/** A real baseline JPEG, 8x8 grey. */
const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAAIAAgBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='
  ),
  (c) => c.charCodeAt(0)
)

test('a JPEG is embedded without being decoded', async () => {
  const image = await prepareImage(JPEG, 'image/jpeg')
  assert.equal(image.width, 8)
  assert.equal(image.height, 8)
  assert.equal(image.filter, 'DCTDecode')
  // Byte-for-byte the original: decoding a photograph would not fit in the
  // CPU a Worker gets, and there is no need to.
  assert.deepEqual(image.data, JPEG)
})

test('a PNG is unfiltered and flattened onto white', async () => {
  const image = await prepareImage(makePng(), 'image/png')
  assert.equal(image.width, 120)
  assert.equal(image.height, 40)
  assert.equal(image.colorSpace, 'DeviceRGB')
  assert.equal(image.filter, 'FlateDecode')
  // Three channels, not four: PDF has no place for PNG's alpha here.
  assert.equal(zlib.inflateSync(Buffer.from(image.data)).length, 120 * 40 * 3)
})

test('a greyscale PNG stays greyscale', async () => {
  const image = await prepareImage(makePng(40, 20, { colorType: 0 }), 'image/png')
  assert.equal(image.colorSpace, 'DeviceGray')
  assert.equal(zlib.inflateSync(Buffer.from(image.data)).length, 40 * 20)
})

test('the bytes decide the format, not the filename', async () => {
  // Phones and conversion tools mislabel images; a photograph that is readable
  // should not be dropped over its name.
  const image = await prepareImage(makePng(), 'image/jpeg')
  assert.equal(image.filter, 'FlateDecode')
})

test('an image that cannot be read is refused, not thrown', async () => {
  // The async path used to hand its rejection back out of the try that was
  // supposed to contain it, which took the whole report down with it.
  const corrupt = makePng()
  corrupt.set([9, 9, 9, 9], 40) // scribble over the compressed data
  assert.equal(await prepareImage(corrupt, 'image/png'), null)

  assert.equal(await prepareImage(new Uint8Array([1, 2, 3]), 'image/png'), null)
  assert.equal(await prepareImage(null, 'image/png'), null)
  assert.equal(await prepareImage(makePng(8, 8, { interlace: 1 }), 'image/png'), null)
})

test('an enormous PNG is left out rather than decoded', async () => {
  // Unfiltering happens in JavaScript, and a Worker has 10 ms of CPU.
  assert.equal(await prepareImage(makePng(900, 900), 'image/png'), null)
})

test('an image is scaled to fit and never enlarged', async () => {
  const image = await prepareImage(JPEG, 'image/jpeg')
  const doc = createPdf({})
  doc.image(image, { maxWidth: 300, maxHeight: 220 })
  const body = checkXref(doc.build())

  assert.match(body, /\/Subtype \/Image/)
  // 8pt wide, its own size, rather than blown up to the 300pt box.
  assert.match(body, /q 8 0 0 8 /)
})

/* ---------------------------------------------------------- the report -- */

const INSPECTION = {
  id: 42,
  unit_name: 'Montreal Catering Unit',
  unit_code: 'YUL',
  department: 'Hot Kitchen',
  shift: 'Night',
  status: 'signed',
  template_version: 1,
  inspector_name: 'Roy Selvarasu',
  summary: 'Two items for the morning briefing.',
  signatures: [
    {
      role: 'inspector',
      signed_name: 'Roy Selvarasu',
      signed_at: '2026-10-10T12:00:00Z',
      image: `data:image/png;base64,${Buffer.from(makePng()).toString('base64')}`,
    },
  ],
}

const COUNTS = {
  critical: 1, needs_improvement: 0, na: 0, satisfactory: 302,
  total: 303, touched: 1, untouched: 302, exceptions: 1,
}

const FINDING = {
  id: 1,
  code: 'GEN-1',
  section: 'General housekeeping',
  text: 'Fire door is kept closed and unobstructed',
  rating: 'critical',
  note: 'Wedged open with a crate at 14:20.',
}

test('the report carries its findings, photograph and signature', async () => {
  const body = checkXref(
    await renderInspectionPdf({
      inspection: INSPECTION,
      findings: [FINDING],
      counts: COUNTS,
      date: '2026-10-10',
      photos: [{ filename: 'item-1-door.jpg', mimeType: 'image/jpeg', bytes: JPEG }],
    })
  )

  assert.match(body, /\(Fire door is kept closed and unobstructed\) Tj/)
  assert.match(body, /\(Wedged open with a crate at 14:20.\) Tj/)
  assert.match(body, /\(Critical\) Tj/)
  // The photograph and the signature: two images, both inside the file, so it
  // still shows the evidence once the originals are purged from Drive.
  assert.equal((body.match(/\/Subtype \/Image/g) || []).length, 2)
  assert.match(body, /Roy Selvarasu .{1,3} Inspector, signed 2026-10-10 12:00:00 UTC/)
})

test('a purged photograph is named with its reason rather than dropped', async () => {
  const body = text(
    await renderInspectionPdf({
      inspection: INSPECTION,
      findings: [FINDING],
      counts: COUNTS,
      date: '2026-10-10',
      photos: [
        { filename: 'item-1-door.jpg', mimeType: 'image/jpeg', unavailable: 'purged on 2026-09-01' },
      ],
    })
  )

  // A report that quietly loses its evidence is worse than one that says so.
  assert.match(body, /purged on 2026-09-01/)
  assert.doesNotMatch(body, /\/Subtype \/Image[^]*\/Subtype \/Image/)
})

test('a clean inspection says so', async () => {
  const body = text(
    await renderInspectionPdf({
      inspection: { ...INSPECTION, signatures: [] },
      findings: [],
      counts: { ...COUNTS, critical: 0, exceptions: 0, touched: 0, untouched: 303 },
      date: '2026-10-10',
    })
  )
  // The brackets round the count are escaped inside the PDF string.
  assert.match(body, /\(Findings \\\(0\\\)\) Tj/)
  assert.match(body, /accepted at its default rating/)
})

test('a long inspection paginates and every page is numbered', async () => {
  const findings = Array.from({ length: 40 }, (_, i) => ({ ...FINDING, id: i + 1, code: `GEN-${i + 1}` }))
  const body = checkXref(
    await renderInspectionPdf({ inspection: INSPECTION, findings, counts: COUNTS, date: '2026-10-10' })
  )

  const pages = pageCount(body)
  assert.ok(pages >= 3, `expected several pages, got ${pages}`)
  for (let page = 1; page <= pages; page += 1) {
    assert.match(body, new RegExp(`page ${page} of ${pages}`), `page ${page} has no number`)
  }
})

test('a signature that will not decode still leaves the attestation', async () => {
  const body = text(
    await renderInspectionPdf({
      inspection: { ...INSPECTION, signatures: [{ ...INSPECTION.signatures[0], image: 'not-an-image' }] },
      findings: [],
      counts: COUNTS,
      date: '2026-10-10',
    })
  )
  // Who signed and when is the record; the drawing is the illustration of it.
  assert.match(body, /Roy Selvarasu/)
  assert.match(body, /signed 2026-10-10 12:00:00 UTC/)
})

test('data URLs are read, and rubbish is refused', () => {
  assert.deepEqual(dataUrlBytes('data:image/png;base64,AQID'), new Uint8Array([1, 2, 3]))
  assert.equal(dataUrlBytes('https://example.com/a.png'), null)
  assert.equal(dataUrlBytes(''), null)
  assert.equal(dataUrlBytes(null), null)
})
