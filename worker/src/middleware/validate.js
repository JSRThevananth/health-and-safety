import { ZodError } from 'zod'
import { fail } from './errors.js'

/**
 * Parse and validate a request's JSON body against a Zod schema, storing the
 * result under c.get('body'). Zod applies its defaults, so handlers can read
 * optional fields without re-checking for undefined.
 */
export const validateBody = (schema) => async (c, next) => {
  let raw
  try {
    raw = c.req.header('content-type')?.includes('application/json') ? await c.req.json() : {}
  } catch {
    throw fail(400, 'Request body is not valid JSON')
  }
  c.set('body', parse(schema, raw))
  await next()
}

/** The same, for the query string. */
export const validateQuery = (schema) => async (c, next) => {
  c.set('query', parse(schema, c.req.query()))
  await next()
}

function parse(schema, value) {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw fail(422, 'Validation failed', {
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    throw error
  }
}
