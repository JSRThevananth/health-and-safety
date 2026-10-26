/**
 * A very small PDF writer.
 *
 * Why write one rather than use a library: a Worker on the free plan gets 10 ms
 * of CPU per request, and the usual options are either a headless browser (not
 * available), a 300 KB+ library that lays out HTML (too slow, and it would have
 * to be shipped to the phone), or a paid conversion service (the project runs
 * at zero cost). What a report actually needs is text in two weights, a rule, a
 * table and some photographs - which is a few hundred lines, no dependency, and
 * fast because the photographs are copied in rather than re-encoded.
 *
 * The output targets PDF 1.4 and uses only base-14 fonts, so nothing has to be
 * embedded and the file opens in anything.
 */

const PAGE = { width: 595.28, height: 841.89 } // A4, in points
const MARGIN = 48
const CONTENT_WIDTH = PAGE.width - MARGIN * 2

/**
 * Character widths for Helvetica, in 1/1000 em, for the printable ASCII range.
 *
 * Needed to wrap a line: without real metrics every paragraph is either guessed
 * short and ragged, or guessed long and runs off the page. Anything outside the
 * range falls back to the average, which only affects where an accented line
 * happens to break.
 */
const WIDTHS = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
}

const AVERAGE_WIDTH = 556

export function textWidth(text, size, bold = false) {
  const table = bold ? WIDTHS.bold : WIDTHS.regular
  let total = 0
  for (const char of String(text)) {
    const code = char.codePointAt(0)
    total += code >= 32 && code <= 126 ? table[code - 32] : AVERAGE_WIDTH
  }
  return (total * size) / 1000
}

/**
 * Wrap text to a width, breaking on spaces, and on characters only when a
 * single word is longer than the line - a 60-character filename with no spaces
 * in it should run onto the next line, not off the edge of the paper.
 */
export function wrap(text, width, size, bold = false) {
  const lines = []
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, size, bold) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      let chunk = ''
      for (const char of word) {
        if (textWidth(chunk + char, size, bold) > width && chunk) {
          lines.push(chunk)
          chunk = ''
        }
        chunk += char
      }
      line = chunk
    }
    lines.push(line)
  }
  return lines.length ? lines : ['']
}

/** PDF string literal escaping, and anything unprintable dropped to ASCII. */
function pdfString(text) {
  const safe = String(text ?? '').replace(/[^\x20-\x7E]/g, (char) => FOLD[char] ?? '?')
  return safe.replace(/[\\()]/g, (c) => `\\${c}`)
}

// The accented characters a Montreal unit will actually type, folded rather
// than replaced with a question mark. WinAnsi would carry them, but folding
// keeps the file to pure ASCII and reads correctly either way.
const FOLD = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ç: 'c', è: 'e', é: 'e', ê: 'e', ë: 'e',
  î: 'i', ï: 'i', í: 'i', ô: 'o', ö: 'o', ó: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u',
  ÿ: 'y', ñ: 'n', œ: 'oe', æ: 'ae', '’': "'", '‘': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '…': '...', '°': ' deg', '•': '-', ' ': ' ',
  '·': '-', '×': 'x', '≤': '<=', '≥': '>=', '€': 'EUR ', '£': 'GBP ',
}

export function createPdf({ title = '', author = '', footer = null } = {}) {
  const pages = []
  const images = []
  let page = null
  let y = 0

  const newPage = () => {
    page = { ops: [], images: [] }
    pages.push(page)
    y = PAGE.height - MARGIN
  }

  /** Start a page lazily, and break before content that will not fit. */
  const need = (height) => {
    if (!page) newPage()
    if (y - height < MARGIN) newPage()
  }

  const doc = {
    get cursor() {
      return y
    },
    get pageCount() {
      return pages.length || 1
    },

    text(content, { size = 10, bold = false, gap = 3, indent = 0, color = null, width } = {}) {
      const lineWidth = width ?? CONTENT_WIDTH - indent
      const lines = wrap(content, lineWidth, size, bold)
      const leading = size * 1.35

      for (const line of lines) {
        need(leading)
        const parts = ['BT']
        if (color) parts.push(`${color.join(' ')} rg`)
        parts.push(`/${bold ? 'FB' : 'FR'} ${size} Tf`)
        parts.push(`1 0 0 1 ${num(MARGIN + indent)} ${num(y - size)} Tm`)
        parts.push(`(${pdfString(line)}) Tj`)
        if (color) parts.push('0 0 0 rg')
        parts.push('ET')
        page.ops.push(parts.join(' '))
        y -= leading
      }
      y -= gap
      return doc
    },

    /** A label and its value on one line, the labels aligned in a column. */
    field(label, value, { labelWidth = 110, size = 10 } = {}) {
      const lines = wrap(value, CONTENT_WIDTH - labelWidth, size)
      need(size * 1.35 * lines.length)
      const top = y
      doc.text(label, { size, bold: true, gap: 0, width: labelWidth })
      y = top
      doc.text(lines.join('\n'), { size, indent: labelWidth, gap: 2 })
      return doc
    },

    rule({ gap = 8, shade = 0.8 } = {}) {
      need(gap * 2)
      y -= gap
      page.ops.push(`${shade} G 0.7 w ${num(MARGIN)} ${num(y)} m ${num(PAGE.width - MARGIN)} ${num(y)} l S 0 G`)
      y -= gap
      return doc
    },

    space(height = 8) {
      if (!page) newPage()
      y -= height
      return doc
    },

    /**
     * Place an image, scaled to fit the box and never enlarged - a signature
     * drawn 300 px wide should stay its own size rather than be blown up into a
     * blur across half the page.
     */
    image(image, { maxWidth = CONTENT_WIDTH, maxHeight = 280, gap = 8 } = {}) {
      if (!image) return doc
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
      const width = image.width * scale
      const height = image.height * scale

      need(height)
      const name = `Im${images.length + 1}`
      images.push({ ...image, name })
      page.images.push(name)
      page.ops.push(
        `q ${num(width)} 0 0 ${num(height)} ${num(MARGIN)} ${num(y - height)} cm /${name} Do Q`
      )
      y -= height + gap
      return doc
    },

    pageBreak() {
      newPage()
      return doc
    },

    build() {
      if (!page) newPage()
      // Stamped last, because "page 2 of 5" cannot be written until the fifth
      // page exists. Printed reports get separated and re-stapled; a page with
      // no number on it is a page nobody can prove is missing.
      if (footer) {
        pages.forEach((target, index) => {
          const text = pdfString(footer(index + 1, pages.length))
          target.ops.push(
            `BT 0.45 0.45 0.45 rg /FR 8 Tf 1 0 0 1 ${num(MARGIN)} ${num(MARGIN - 18)} Tm (${text}) Tj 0 0 0 rg ET`
          )
        })
      }
      return assemble({ pages, images, title, author })
    },
  }

  return doc
}

const num = (value) => (Math.round(value * 100) / 100).toString()

/* ------------------------------------------------------------- the file -- */

function assemble({ pages, images, title, author }) {
  const encoder = new TextEncoder()
  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length // 1-based object number
  }

  // Reserved up front so the page objects can name their parent before it exists.
  const catalogId = add(null)
  const pagesId = add(null)
  const fontRegular = add(encoder.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  const fontBold = add(encoder.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))

  const imageIds = new Map()
  for (const image of images) {
    const dict =
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}` +
      ` /ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter}` +
      ` /Length ${image.data.byteLength} >>`
    imageIds.set(image.name, add(stream(encoder.encode(dict), image.data)))
  }

  const pageIds = []
  for (const p of pages) {
    const content = encoder.encode(p.ops.join('\n'))
    const contentId = add(stream(encoder.encode(`<< /Length ${content.byteLength} >>`), content))

    const xobjects = p.images.length
      ? ` /XObject << ${p.images.map((name) => `/${name} ${imageIds.get(name)} 0 R`).join(' ')} >>`
      : ''
    pageIds.push(
      add(
        encoder.encode(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(PAGE.width)} ${num(PAGE.height)}]` +
            ` /Resources << /Font << /FR ${fontRegular} 0 R /FB ${fontBold} 0 R >>${xobjects} >>` +
            ` /Contents ${contentId} 0 R >>`
        )
      )
    )
  }

  objects[catalogId - 1] = encoder.encode(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  objects[pagesId - 1] = encoder.encode(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`
  )
  const infoId = add(
    encoder.encode(`<< /Title (${pdfString(title)}) /Author (${pdfString(author)}) /Producer (QA Platform) >>`)
  )

  // Body, then the cross-reference table, which needs every object's byte offset.
  const chunks = [encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]
  let offset = chunks[0].byteLength
  const offsets = []

  objects.forEach((body, index) => {
    offsets.push(offset)
    const head = encoder.encode(`${index + 1} 0 obj\n`)
    const tail = encoder.encode('\nendobj\n')
    chunks.push(head, body, tail)
    offset += head.byteLength + body.byteLength + tail.byteLength
  })

  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n']
  for (const at of offsets) xref.push(`${String(at).padStart(10, '0')} 00000 n \n`)
  chunks.push(
    encoder.encode(
      `${xref.join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    )
  )

  return concat(chunks)
}

function stream(dict, data) {
  return concat([dict, new TextEncoder().encode('\nstream\n'), data, new TextEncoder().encode('\nendstream')])
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/* ----------------------------------------------------------- the images -- */

/**
 * Prepare an image for embedding.
 *
 * A JPEG is copied in untouched: PDF reads JPEG natively through DCTDecode, so
 * a 300 KB photograph costs no decoding at all, which is what keeps this inside
 * the CPU budget. A PNG has to be unpacked, because PDF cannot read PNG's
 * per-row filters directly and canvas writes an alpha channel PDF has no place
 * for - so it is inflated, unfiltered, flattened onto white and deflated again.
 *
 * Returns null rather than throwing: a report missing one photograph is worth
 * sending; a report that failed to generate is not.
 */
export async function prepareImage(bytes, mimeType = '') {
  try {
    // The bytes decide, not the name. Phones and conversion tools mislabel
    // images often enough that trusting the mime type here would mean a report
    // quietly losing a photograph that was perfectly readable.
    // Awaited rather than returned: a rejected promise handed back from inside
    // this try would escape the catch, and the whole point of the catch is that
    // one unreadable image cannot take the report down with it.
    if (isJpeg(bytes)) return jpegImage(bytes)
    if (isPng(bytes)) return await pngImage(bytes)
    if (/jpe?g/i.test(mimeType)) return jpegImage(bytes)
    if (/png/i.test(mimeType)) return await pngImage(bytes)
  } catch {
    return null
  }
  return null
}

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8
const isPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** Dimensions and component count from the JPEG's start-of-frame marker. */
function jpegImage(bytes) {
  let i = 2
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    // Any SOF except the arithmetic-coded and hierarchical ones, which carry the
    // same five header bytes in the same order.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      const components = bytes[i + 9]
      if (!width || !height) return null
      return {
        width,
        height,
        colorSpace: components === 1 ? 'DeviceGray' : 'DeviceRGB',
        filter: 'DCTDecode',
        data: bytes,
      }
    }
    i += 2 + length
  }
  return null
}

/** The most pixels a PNG may have before it is left out rather than decoded. */
const MAX_PNG_PIXELS = 400_000

async function pngImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const depth = bytes[24]
  const colorType = bytes[25]
  const interlace = bytes[28]

  // 8-bit, non-interlaced, grey/RGB with or without alpha. Everything else -
  // palettes, 16-bit, Adam7 - is rarer than it is worth the code to support,
  // and the caller falls back to text.
  if (depth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType)) return null
  if (width * height > MAX_PNG_PIXELS) return null

  const sourceChannels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  const outChannels = colorType === 0 || colorType === 4 ? 1 : 3

  // Every IDAT chunk, concatenated: a PNG may split the stream across several.
  const parts = []
  let at = 8
  while (at < bytes.length - 8) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    if (type === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length))
    if (type === 'IEND') break
    at += 12 + length
  }
  if (parts.length === 0) return null

  const raw = new Uint8Array(await inflate(concat(parts)))
  const stride = width * sourceChannels
  if (raw.byteLength < (stride + 1) * height) return null

  // Undo the per-row filters, then flatten any alpha onto white: PDF has no
  // place for an alpha channel without a separate soft mask, and these images
  // are signatures drawn on white in the first place.
  const flat = new Uint8Array(width * height * outChannels)
  const line = new Uint8Array(stride)
  const previous = new Uint8Array(stride)

  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1)
    const filter = raw[start]
    line.set(raw.subarray(start + 1, start + 1 + stride))
    unfilter(filter, line, previous, sourceChannels)

    for (let x = 0; x < width; x += 1) {
      const from = x * sourceChannels
      const to = (row * width + x) * outChannels
      const alpha = sourceChannels === 2 || sourceChannels === 4 ? line[from + sourceChannels - 1] / 255 : 1
      for (let c = 0; c < outChannels; c += 1) {
        flat[to + c] = Math.round(line[from + c] * alpha + 255 * (1 - alpha))
      }
    }
    previous.set(line)
  }

  return {
    width,
    height,
    colorSpace: outChannels === 1 ? 'DeviceGray' : 'DeviceRGB',
    filter: 'FlateDecode',
    data: new Uint8Array(await deflate(flat)),
  }
}

/** PNG's five row filters, undone in place. */
function unfilter(type, line, previous, channels) {
  const length = line.length
  if (type === 0) return
  for (let i = 0; i < length; i += 1) {
    const left = i >= channels ? line[i - channels] : 0
    const up = previous[i]
    const upLeft = i >= channels ? previous[i - channels] : 0
    switch (type) {
      case 1:
        line[i] = (line[i] + left) & 0xff
        break
      case 2:
        line[i] = (line[i] + up) & 0xff
        break
      case 3:
        line[i] = (line[i] + ((left + up) >> 1)) & 0xff
        break
      case 4: {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const best = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        line[i] = (line[i] + best) & 0xff
        break
      }
      default:
        break
    }
  }
}

// The platform's own zlib, so neither of these costs us CPU we do not have.
const inflate = (bytes) =>
  new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()

const deflate = (bytes) =>
  new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()
