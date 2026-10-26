import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'qa.theme'
const ThemeContext = createContext(null)

/** Three states: 'light', 'dark', or 'system' (follow the OS). */
const read = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    // Private windows and blocked site data throw on access.
    return 'system'
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(read)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  )

  // Track the OS setting so 'system' stays live rather than sampled once.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    // No stamp for 'system' - the media query in tokens.css takes over.
    if (preference === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', preference)

    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Persisting is a convenience; the theme still applies for this session.
    }
  }, [preference])

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference,
      toggle: () => setPreference(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [preference, resolved]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
