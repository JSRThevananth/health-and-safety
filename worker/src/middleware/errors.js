import { HTTPException } from 'hono/http-exception'

/** Throw this instead of returning a response from deep inside a service. */
export function fail(status, message, extra = {}) {
  return new HTTPException(status, {
    res: Response.json({ error: message, ...extra }, { status }),
  })
}

/**
 * Turn anything that escaped a handler into a JSON response.
 *
 * A Worker that throws returns a Cloudflare error page, which the React client
 * cannot parse - so the user would see "Unexpected token <" instead of the actual
 * problem. Everything leaves here as JSON.
 */
export function onError(error, c) {
  if (error instanceof HTTPException) return error.getResponse()

  // A genuine bug. Log it where wrangler tail will show it, and tell the client
  // nothing that would help someone probe the internals.
  console.error('[error]', error?.stack || error)
  return c.json(
    {
      error: 'Internal server error',
      ...(c.get('config')?.environment !== 'production' ? { detail: String(error?.message || error) } : {}),
    },
    500
  )
}

export function notFound(c) {
  return c.json({ error: `No route for ${c.req.method} ${new URL(c.req.url).pathname}` }, 404)
}
