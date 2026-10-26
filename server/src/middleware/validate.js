import { ZodError } from 'zod'

/** Validate `req[source]` against a Zod schema, replacing it with the parsed value. */
export const validate = (schema, source = 'body') => (req, res, next) => {
  try {
    req[source] = schema.parse(req[source])
    next()
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    next(error)
  }
}

/** Wrap an async handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
