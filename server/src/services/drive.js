import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { google } from 'googleapis'
import { config } from '../config.js'

const SCOPES = ['https://www.googleapis.com/auth/drive.file']

let driveClient

function loadCredentials() {
  if (config.drive.credentialsJson) return JSON.parse(config.drive.credentialsJson)
  if (config.drive.credentialsFile) {
    const file = path.resolve(config.rootDir, config.drive.credentialsFile)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  throw new Error('No Google Drive credentials configured')
}

function getDrive() {
  if (driveClient) return driveClient
  const credentials = loadCredentials()
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
  driveClient = google.drive({ version: 'v3', auth })
  return driveClient
}

export function driveEnabled() {
  return config.drive.enabled && Boolean(config.drive.credentialsFile || config.drive.credentialsJson)
}

/**
 * Persist an uploaded buffer. Uses Google Drive when configured and falls back to the
 * local upload directory otherwise, so the app is fully usable before any cloud setup.
 * Returns the row shape the `attachments` table expects.
 */
export async function storeFile({ buffer, filename, mimeType }) {
  if (!driveEnabled()) return storeLocally({ buffer, filename, mimeType })

  const drive = getDrive()
  const { data } = await drive.files.create({
    requestBody: {
      name: filename,
      ...(config.drive.folderId ? { parents: [config.drive.folderId] } : {}),
    },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, size, webViewLink',
  })

  return {
    storage: 'gdrive',
    storage_ref: data.id,
    web_view_link: data.webViewLink || '',
    size_bytes: Number(data.size || buffer.length),
  }
}

function storeLocally({ buffer, filename }) {
  const dir = path.resolve(config.rootDir, config.drive.localFallbackDir)
  fs.mkdirSync(dir, { recursive: true })
  const safeName = `${randomUUID()}-${path.basename(filename).replace(/[^\w.\-]/g, '_')}`
  fs.writeFileSync(path.join(dir, safeName), buffer)
  return { storage: 'local', storage_ref: safeName, web_view_link: '', size_bytes: buffer.length }
}

/** Stream a stored file back to the caller. */
export async function readFile(attachment) {
  if (attachment.storage === 'local') {
    const dir = path.resolve(config.rootDir, config.drive.localFallbackDir)
    const filePath = path.join(dir, attachment.storage_ref)
    // storage_ref is generated server-side, but re-check it stays inside the upload dir.
    if (path.dirname(filePath) !== dir) throw new Error('Invalid attachment reference')
    return fs.createReadStream(filePath)
  }
  const drive = getDrive()
  const response = await drive.files.get(
    { fileId: attachment.storage_ref, alt: 'media' },
    { responseType: 'stream' }
  )
  return response.data
}

export async function deleteFile(attachment) {
  if (attachment.storage === 'local') {
    const dir = path.resolve(config.rootDir, config.drive.localFallbackDir)
    const filePath = path.join(dir, attachment.storage_ref)
    if (path.dirname(filePath) === dir) fs.rmSync(filePath, { force: true })
    return
  }
  await getDrive().files.delete({ fileId: attachment.storage_ref })
}
