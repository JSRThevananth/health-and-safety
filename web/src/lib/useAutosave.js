import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Debounced autosave for the inspection form.
 *
 * Inspectors work with gloves on a noisy floor; nobody presses a save button. Edits
 * are queued by item, flushed a moment after typing stops, and flushed immediately
 * when the page is hidden - a locked phone or a switched app is the most likely way
 * an inspection would otherwise be lost.
 */
export function useAutosave(save, { delay = 1200, maxBackoff = 30000 } = {}) {
  const pending = useRef(new Map())
  const timer = useRef(null)
  const retry = useRef(null)
  const attempts = useRef(0)
  const inFlight = useRef(false)
  const [status, setStatus] = useState('idle') // idle | pending | saving | saved | error

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (retry.current) {
      clearTimeout(retry.current)
      retry.current = null
    }
    if (pending.current.size === 0 || inFlight.current) return

    const batch = [...pending.current.values()]
    pending.current.clear()
    inFlight.current = true
    setStatus('saving')

    try {
      await save(batch)
      attempts.current = 0
      setStatus(pending.current.size > 0 ? 'pending' : 'saved')
    } catch {
      // Put the batch back so nothing is dropped. A newer edit to the same item
      // wins, since it is the more recent truth.
      for (const item of batch) {
        if (!pending.current.has(item.template_item_id)) {
          pending.current.set(item.template_item_id, item)
        }
      }
      setStatus('error')

      /*
       * Retry on our own schedule rather than waiting for the next edit. On free
       * hosting the API sleeps when idle and the first request can take most of a
       * minute, so a failure here is expected rather than exceptional - and an
       * inspector who taps one item and stops would otherwise lose it.
       */
      attempts.current += 1
      const wait = Math.min(1000 * 2 ** (attempts.current - 1), maxBackoff)
      if (retry.current) clearTimeout(retry.current)
      retry.current = setTimeout(() => { retry.current = null; flush() }, wait)
    } finally {
      inFlight.current = false
    }
  }, [save, maxBackoff])

  const queue = useCallback(
    (item) => {
      pending.current.set(item.template_item_id, item)
      setStatus('pending')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [flush, delay]
  )

  // Save on the way out: backgrounding the app is the common case on a phone.
  // Coming back, or regaining signal, is the best moment to retry a failed save.
  useEffect(() => {
    const onVisibility = () => flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('online', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('online', flush)
      flush()
    }
  }, [flush])

  // Last line of defence against closing the tab mid-save.
  useEffect(() => {
    const warn = (event) => {
      if (pending.current.size > 0 || inFlight.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Stop retrying once the component goes away.
  useEffect(() => () => {
    if (retry.current) clearTimeout(retry.current)
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { queue, flush, status, hasPending: () => pending.current.size > 0 }
}
