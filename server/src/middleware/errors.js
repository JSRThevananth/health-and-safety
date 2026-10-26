export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` })
}

export function errorHandler(error, req, res, _next) {
  const status = error.status || 500
  if (status >= 500) console.error('[error]', error)
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : error.message,
    ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { detail: error.message } : {}),
  })
}
