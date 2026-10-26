import { randomId } from '../crypto.js'

/**
 * Evidence storage: photos and documents attached to findings.
 *
 * Two backends, chosen with STORAGE_BACKEND:
 *
 *  drive  The customer's own Google Drive. The default: it needs no payment
 *         method anywhere, which is the whole constraint this project runs under.
 *  r2     Cloudflare's own object store. Faster and simpler, but enabling R2
 *         asks for a card on file even at zero spend.
 *
 * Both return the row shape the attachments table expects, so nothing above this
 * file knows which one is in use.
 *
 * Photos arrive already downscaled by the browser (see web/src/lib/image.js), so
 * a phone photo costs a few hundred KB here rather than several megabytes. That
 * is what keeps Drive quota, upload time on a unit's wifi, and the size of an
 * emailed report all within their limits.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

// Evidence is photos and documents; nothing executable.
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export const storageBackend = (config) => config.storage.backend

/** A key that cannot collide and cannot be guessed from the filename. */
const objectKey = (filename) =>
  `${new Date().toISOString().slice(0, 10)}/${randomId()}-${filename.replace(/[^\w.\-]/g, '_').slice(-80)}`

export async function storeFile(env, config, { bytes, filename, mimeType }) {
  if (config.storage.backend === 'r2') {
    if (!env.EVIDENCE) throw new Error('STORAGE_BACKEND is "r2" but no R2 bucket is bound')
    const key = objectKey(filename)
    await env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: mimeType } })
    return { storage: 'r2', storage_ref: key, web_view_link: '', size_bytes: bytes.byteLength }
  }

  if (config.storage.backend === 'drive') {
    return storeInDrive(config, { bytes, filename, mimeType })
  }

  throw new Error('No evidence storage is configured. Set STORAGE_BACKEND to "r2" or "drive".')
}

/** The stored bytes, as a Response the route can return directly. */
export async function readFile(env, config, attachment) {
  if (attachment.storage === 'r2') {
    if (!env.EVIDENCE) throw new Error('This attachment is in R2 but no R2 bucket is bound')
    const object = await env.EVIDENCE.get(attachment.storage_ref)
    if (!object) return null
    return object.body
  }

  if (attachment.storage === 'gdrive') {
    const token = await driveAccessToken(config)
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attachment.storage_ref)}?alt=media`,
      { headers: { authorization: `Bearer ${token}` } }
    )
    if (!response.ok) return null
    return response.body
  }

  // 'local' rows were written by the Node build against a disk this Worker has no
  // access to. Say so rather than returning a confusing empty file.
  throw new Error('This attachment was stored on the old server and is not reachable from here')
}

export async function deleteFile(env, config, attachment) {
  if (attachment.storage === 'r2') {
    if (env.EVIDENCE) await env.EVIDENCE.delete(attachment.storage_ref)
    return
  }
  if (attachment.storage === 'gdrive') {
    const token = await driveAccessToken(config)
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attachment.storage_ref)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
  }
}

/* ------------------------------------------------------------ Google Drive -- */

/**
 * Get an access token for Drive.
 *
 * Two ways in, because which one works depends on the kind of Google account:
 *
 *  refresh token    Acts as the account owner. Files are owned by them and count
 *                   against their own 15 GB. This is the only option that works
 *                   on a personal Gmail account.
 *  service account  Acts as a robot with no storage of its own. Google refuses
 *                   its uploads to a personal My Drive - "Service Accounts do not
 *                   have storage quota" - even when the folder is shared with it.
 *                   It works only against a Workspace shared drive.
 *
 * A token lasts an hour; it is cached for the life of the isolate so a burst of
 * uploads costs one exchange rather than one per photo.
 */
let cachedToken = null

// Exported because the monthly sheet writer needs the same token, and minting a
// second one per run would waste a subrequest on every build.
export async function driveAccessToken(config) {
  // Keyed by the credential, not just time: rotating a refresh token or moving
  // a deployment to a different Google account must not keep working on a token
  // minted from the old one.
  const key = config.storage.driveRefreshToken || config.storage.driveCredentials
  if (cachedToken && cachedToken.key === key && cachedToken.expires > Date.now() + 60_000) {
    return cachedToken.value
  }

  const body = config.storage.driveRefreshToken
    ? new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.storage.driveClientId,
        client_secret: config.storage.driveClientSecret,
        refresh_token: config.storage.driveRefreshToken,
      })
    : new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await serviceAccountAssertion(config),
      })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    // The refusal text names the cause (expired refresh token, revoked consent,
    // wrong client) and there is nothing sensitive in it.
    throw new Error(`Google refused the Drive credentials: ${await response.text()}`)
  }

  const token = await response.json()
  cachedToken = { key, value: token.access_token, expires: Date.now() + (token.expires_in - 60) * 1000 }
  return cachedToken.value
}

/** Sign the JWT a service account exchanges for a token. Shared drives only. */
async function serviceAccountAssertion(config) {
  const credentials = JSON.parse(config.storage.driveCredentials)
  const issued = Math.floor(Date.now() / 1000)
  const claims = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: issued,
    exp: issued + 3600,
  }

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)))
  const key = await importPrivateKey(credentials.private_key)
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${body}`))
  )
  return `${header}.${body}.${b64url(signature)}`
}

/** Turn the PEM in the service-account JSON into a key WebCrypto will sign with. */
async function importPrivateKey(pem) {
  const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

async function storeInDrive(config, { bytes, filename, mimeType }) {
  const token = await driveAccessToken(config)
  const metadata = {
    name: filename,
    ...(config.storage.driveFolderId ? { parents: [config.storage.driveFolderId] } : {}),
  }

  // Multipart upload: metadata and bytes in one request, which is one round trip
  // instead of the create-then-upload pair a resumable upload needs.
  const boundary = `qa${randomId()}`
  const body = new Blob([
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--\r\n`,
  ])

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size,webViewLink',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )
  if (!response.ok) throw new Error(`Drive upload failed: ${await response.text()}`)

  const data = await response.json()
  return {
    storage: 'gdrive',
    storage_ref: data.id,
    web_view_link: data.webViewLink || '',
    size_bytes: Number(data.size || bytes.byteLength),
  }
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
