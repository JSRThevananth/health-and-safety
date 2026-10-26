import { isAppsScript, appsScriptRequest } from './appsScriptBridge.js'

// Optional chaining because import.meta.env only exists under Vite: without it
// this module cannot be imported by a plain node:test, and the error it throws
// then has nothing to do with the thing being tested.
const BASE = import.meta.env?.VITE_API_BASE_URL || '/api'
const TOKEN_KEY = 'qa.token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

export class ApiError extends Error {
  constructor(status, payload) {
    super(describe(status, payload))
    this.status = status
    this.payload = payload
    this.issues = payload?.issues ?? []
  }
}

/**
 * The message a person should see.
 *
 * A validation failure arrives as a generic headline plus a list of what
 * actually went wrong. Showing only the headline produces "Validation failed"
 * on screen, which tells the person nothing and sent one real user round in
 * circles retyping a password that was simply too short. The detail is what
 * matters, so it is what gets shown.
 */
function describe(status, payload) {
  const issues = payload?.issues
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.map((issue) => issue.message).join('. ')
  }
  return payload?.error || `Request failed (${status})`
}

/**
 * Thin fetch wrapper: attaches the bearer token, unwraps JSON, and turns non-2xx
 * responses into ApiError. Pass `body` for JSON or `form` for a FormData upload.
 */
export async function api(path, { method = 'GET', body, form, auth = true } = {}) {
  // Inside Apps Script there is no HTTP endpoint to call; the bridge routes the
  // same request through google.script.run and returns the same shape.
  if (isAppsScript()) return appsScriptRequest(path, { method, body })

  const headers = {}
  if (auth && getToken()) headers.authorization = `Bearer ${getToken()}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  // An expired token should drop the session rather than surface as a generic error.
  if (response.status === 401 && auth) {
    clearToken()
    window.dispatchEvent(new Event('qa:unauthorized'))
  }

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new ApiError(response.status, payload)
  return payload
}

/**
 * Download a file the API returns as bytes rather than JSON.
 *
 * Needed because a plain link cannot carry the bearer token: the browser would
 * send an unauthenticated GET and land on a 401 page instead of a file. So the
 * fetch happens here, with the token attached, and the bytes are handed to the
 * browser as a blob.
 */
export async function apiDownload(path, filename) {
  const headers = {}
  if (getToken()) headers.authorization = `Bearer ${getToken()}`

  const response = await fetch(`${BASE}${path}`, { headers })
  if (!response.ok) {
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { error: text }
    }
    throw new ApiError(response.status, payload)
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick rather than immediately: Safari cancels a download
  // whose object URL is released while the click is still being handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const login = async (username, password) => {
  const data = await api('/auth/login', { method: 'POST', body: { username, password }, auth: false })
  setToken(data.access_token)
  return data.user
}

export const me = () => api('/auth/me')
export const health = () => api('/health', { auth: false })
