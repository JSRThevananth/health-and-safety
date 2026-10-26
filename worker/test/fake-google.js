/**
 * A stand-in for Google's token endpoint, Drive, and Brevo.
 *
 * Everything the Worker does with the outside world goes through fetch, so one
 * interception covers all three. The point is to exercise the real code paths -
 * the token exchange, the multipart upload, the download, the Brevo payload -
 * rather than to mock them away: the report compiler's whole job is retrieving
 * photos from Drive, and a test that skips that tests nothing.
 */

const realFetch = globalThis.fetch

export function installFakeGoogle({ failDownloadFor = [] } = {}) {
  const state = {
    files: new Map(), // Drive file id -> { bytes, name, mimeType, parents }
    tokenExchanges: 0,
    sentEmails: [],
    nextId: 1,
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const method = (init.method || 'GET').toUpperCase()

    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      state.tokenExchanges += 1
      const body = String(init.body)
      if (body.includes('refresh_token=expired')) {
        return new Response('{"error":"invalid_grant"}', { status: 400 })
      }
      return Response.json({ access_token: `fake-token-${state.tokenExchanges}`, expires_in: 3600 })
    }

    // Replacing the contents of a file that already exists: how the monthly
    // sheet is rebuilt. Same id back, so a link to it stays valid.
    const replace = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/([^?]+)\?/.exec(url)
    if (replace && method === 'PATCH') {
      const id = decodeURIComponent(replace[1])
      if (!state.files.has(id)) return new Response('not found', { status: 404 })
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
      state.files.set(id, { ...state.files.get(id), bytes, raw: bytes })
      return Response.json({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` })
    }

    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const id = `drive-file-${state.nextId++}`
      const raw = new Uint8Array(await new Response(init.body).arrayBuffer())
      // Store what Drive would store - the file part - rather than the whole
      // multipart envelope, or a download would hand back the boundaries too and
      // the test would pass on bytes that are not the photo.
      const bytes = fileFromMultipart(raw, init.headers['content-type'])
      // The metadata part names the Drive type being requested - for the monthly
      // export that is a Google Sheet, converted from the CSV uploaded with it.
      const metadata = metadataFromMultipart(raw)
      state.files.set(id, { bytes, raw, metadata })
      return Response.json({
        id,
        size: String(bytes.byteLength),
        webViewLink: `https://drive.google.com/file/d/${id}/view`,
      })
    }

    const download = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(url)
    if (download) {
      const id = decodeURIComponent(download[1])
      if (failDownloadFor.includes(id)) return new Response('nope', { status: 500 })
      const file = state.files.get(id)
      if (!file) return new Response('not found', { status: 404 })
      return new Response(file.bytes)
    }

    const remove = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)$/.exec(url)
    if (remove && method === 'DELETE') {
      state.files.delete(decodeURIComponent(remove[1]))
      return new Response(null, { status: 204 })
    }

    if (url.startsWith('https://api.brevo.com/v3/smtp/email')) {
      const payload = JSON.parse(init.body)
      state.sentEmails.push(payload)
      return Response.json({ messageId: `msg-${state.sentEmails.length}` })
    }

    throw new Error(`Unexpected outbound request in a test: ${method} ${url}`)
  }

  return state
}

export function restoreFetch() {
  globalThis.fetch = realFetch
}

/** The Drive env a harness needs to use the fake. */
export const DRIVE_ENV = {
  STORAGE_BACKEND: 'drive',
  GDRIVE_CLIENT_ID: 'fake-client-id',
  GDRIVE_CLIENT_SECRET: 'fake-client-secret',
  GDRIVE_REFRESH_TOKEN: 'fake-refresh-token',
  GDRIVE_FOLDER_ID: 'fake-folder',
  PUBLIC_URL: 'https://qa.example.workers.dev',
}

/**
 * Pull the file part out of a multipart/related upload.
 *
 * Byte-wise rather than by decoding to text: the body is binary, and a round
 * trip through a string would corrupt any byte that is not valid UTF-8.
 */
function fileFromMultipart(raw, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType || '')?.[1]
  if (!boundary) return raw

  const marker = new TextEncoder().encode(`--${boundary}`)
  const parts = []
  let start = 0
  for (let i = 0; i <= raw.length - marker.length; i += 1) {
    if (marker.every((b, k) => raw[i + k] === b)) {
      if (start) parts.push(raw.subarray(start, i))
      start = i + marker.length
    }
  }
  // The second part is the file; each part is headers, a blank line, then bytes.
  const part = parts[1]
  if (!part) return raw

  for (let i = 0; i < part.length - 3; i += 1) {
    if (part[i] === 13 && part[i + 1] === 10 && part[i + 2] === 13 && part[i + 3] === 10) {
      // Trailing CRLF before the next boundary is not part of the file.
      return part.subarray(i + 4, part.length - 2)
    }
  }
  return part
}

/** The JSON metadata part of a multipart upload, or {} if it cannot be read. */
function metadataFromMultipart(raw) {
  const text = new TextDecoder().decode(raw)
  const match = /\{[^]*?\}/.exec(text)
  try {
    return match ? JSON.parse(match[0]) : {}
  } catch {
    return {}
  }
}
