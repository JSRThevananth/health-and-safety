/**
 * Runs the same React app inside Apps Script.
 *
 * Apps Script has no HTTP routes: the page talks to the server through
 * google.script.run, which is callback-based and one function wide. This maps the
 * REST-shaped calls the app already makes onto that single entry point, so no
 * component or page needed changing to support both.
 */

export const isAppsScript = () =>
  typeof google !== 'undefined' && google.script && google.script.run

const TOKEN_KEY = 'qa.token'
const token = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

/** Promise wrapper around google.script.run, which is callback-based. */
function callServer(action, payload) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      // A thrown Apps Script error arrives stripped of its message, which is why
      // the server returns failures as data. This only catches genuine transport
      // faults - a dropped connection, a timeout.
      .withFailureHandler((error) => reject(new Error(error?.message || 'Connection lost')))
      .api(action, payload)
  })
}

/**
 * Translate a REST path and method into an Apps Script action.
 *
 * Keeping the app's existing call shape means the pages are identical between the
 * two builds; only this table knows the difference.
 */
export function toAction(path, method, body) {
  const [route, query] = path.split('?')
  const params = new URLSearchParams(query || '')
  const segments = route.split('/').filter(Boolean)
  const payload = Object.assign({}, body || {})
  params.forEach((value, key) => { payload[key] = value })

  const is = (...parts) =>
    segments.length === parts.length &&
    parts.every((p, i) => (p === '*' ? true : p === segments[i]))

  if (is('health')) return ['health', payload]
  if (is('auth', 'login')) return ['login', payload]
  if (is('auth', 'me')) return ['me', payload]
  if (is('auth', 'change-password')) return ['changePassword', payload]
  if (is('units')) return ['listUnits', payload]
  if (is('units', '*', 'template')) return ['getTemplate', { ...payload, unit_id: Number(segments[1]) }]

  if (is('inspections', 'draft')) {
    return [method === 'POST' ? 'openInspection' : 'getInspectionDraft', payload]
  }
  if (is('inspections')) return ['listInspections', payload]
  if (is('inspections', '*', 'submit')) {
    return ['submitInspection', { ...payload, inspection_id: Number(segments[1]) }]
  }
  if (is('inspections', '*', 'sign')) {
    return ['signInspection', { ...payload, inspection_id: Number(segments[1]) }]
  }
  if (is('inspections', '*')) {
    const inspection_id = Number(segments[1])
    if (method === 'PATCH') return ['saveInspection', { ...payload, inspection_id }]
    if (method === 'DELETE') return ['discardInspection', { ...payload, inspection_id }]
    return ['getInspection', { ...payload, inspection_id }]
  }
  if (is('attachments')) return ['listAttachments', payload]

  throw new Error(`No Apps Script action for ${method} ${route}`)
}

/** Same contract as the fetch-based client, so callers cannot tell them apart. */
export async function appsScriptRequest(path, { method = 'GET', body } = {}) {
  const [action, payload] = toAction(path, method, body)
  const response = await callServer(action, { ...payload, token: token() })

  if (!response || response.ok !== true) {
    const error = new Error(response?.error || 'Request failed')
    error.code = response?.code
    // The app's existing session handling keys off 401, so map the two server
    // conditions that mean "you are not who you were" onto it.
    error.status = /session has ended|Invalid credentials/i.test(error.message) ? 401 : 400
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') error.status = 403
    throw error
  }
  return response.data
}
