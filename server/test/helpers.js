import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Point the app at a throwaway database.
 *
 * This runs as a module side effect, not inside an exported function, because
 * src/config.js snapshots these variables the moment it is first imported. Static
 * imports are hoisted, so any test file importing a fixture that pulls in the config
 * would otherwise capture the real database path before a setup call could run.
 * Import this module before anything that touches src/.
 */
export const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-test-'))

process.env.DATABASE_FILE = path.join(tmpDir, 'test.db')
process.env.LOCAL_UPLOAD_DIR = path.join(tmpDir, 'uploads')
process.env.JWT_SECRET = 'test-secret'
process.env.BREVO_ENABLED = 'false'
process.env.GDRIVE_ENABLED = 'false'

/** Boot the app on an ephemeral port and return a fetch helper bound to it. */
export async function startServer(createApp) {
  const server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  const request = async (method, url, { token, json, form, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } }
    if (token) init.headers.authorization = `Bearer ${token}`
    if (json !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(json)
    }
    if (form) init.body = form
    const response = await fetch(base + url, init)
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { status: response.status, body, headers: response.headers }
  }

  return { base, request, close: () => new Promise((resolve) => server.close(resolve)) }
}
