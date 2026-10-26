/*
 * Wake the API before the user needs it.
 *
 * Free hosting suspends an idle service, and the first request can take most of a
 * minute. Waiting for the sign-in button to trigger that means the user watches a
 * spinner. Pinging as soon as the page loads spends that time while they are still
 * reading and typing, so the wake happens in parallel with them rather than after.
 *
 * Deliberately silent: this is an optimisation, and a failed warm-up must never
 * surface an error or block anything. The real request behind it still works, it is
 * just slower.
 */
// Optional chaining because import.meta.env only exists under Vite: without it
// this module cannot be imported by a plain node:test, and the error it throws
// then has nothing to do with the thing being tested.
const BASE = import.meta.env?.VITE_API_BASE_URL || '/api'

// Don't re-ping on every render or route change; once per page load is the point.
let inFlight = null
let lastPing = 0
const MIN_GAP_MS = 60_000

export function warmUp() {
  const now = Date.now()
  if (inFlight) return inFlight
  if (now - lastPing < MIN_GAP_MS) return Promise.resolve()

  lastPing = now
  inFlight = fetch(`${BASE}/health`, { method: 'GET', cache: 'no-store' })
    .catch(() => {
      // Asleep, offline, or still starting. Nothing to do and nothing to report.
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/**
 * Keep it warm while someone has the app open, so a long inspection does not hit a
 * sleeping API when it finally autosaves. Returns a cleanup function.
 */
export function keepWarm(intervalMs = 10 * 60 * 1000) {
  const tick = () => {
    // No point pinging from a backgrounded tab; browsers throttle those timers
    // anyway, and a hidden tab is not about to make a request.
    if (document.visibilityState === 'visible') warmUp()
  }
  const id = setInterval(tick, intervalMs)
  document.addEventListener('visibilitychange', tick)
  return () => {
    clearInterval(id)
    document.removeEventListener('visibilitychange', tick)
  }
}
