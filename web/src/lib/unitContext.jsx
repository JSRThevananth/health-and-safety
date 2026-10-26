import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { useAuth } from './auth.jsx'

const STORAGE_KEY = 'qa.unit'
const UnitContext = createContext(null)

/**
 * The unit the user is currently working in.
 *
 * The selectable list comes from the API, which returns only units the account may
 * reach. Selection is a view filter, never a grant: choosing a unit cannot widen
 * access, because the server scopes every response independently.
 *
 * An admin additionally gets "All units" (null), which unit-scoped users do not.
 */
export function UnitProvider({ children }) {
  const { user } = useAuth()
  const [units, setUnits] = useState([])
  const [unitId, setUnitId] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAdmin = user?.unit_ids === null

  useEffect(() => {
    // Nothing to fetch before sign-in, and the API blocks every unit route while a
    // temporary password is still in force - requesting it would only 401/403.
    if (!user || user.must_change_password) {
      setUnits([])
      setUnitId(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    api('/units')
      .then((list) => {
        if (cancelled) return
        setUnits(list)

        let stored = null
        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          stored = raw ? Number(raw) : null
        } catch {
          stored = null
        }

        // Fall back if the stored unit is no longer one this account can reach.
        const valid = stored !== null && list.some((u) => u.id === stored)
        if (valid) setUnitId(stored)
        else if (isAdmin) setUnitId(null)
        else setUnitId(list[0]?.id ?? null)
      })
      .catch(() => setUnits([]))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [user, isAdmin])

  const select = (id) => {
    setUnitId(id)
    try {
      if (id === null) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, String(id))
    } catch {
      // Remembering the choice is a convenience; the session still works without it.
    }
  }

  const value = useMemo(
    () => ({
      units,
      unitId,
      unit: units.find((u) => u.id === unitId) ?? null,
      isAdmin,
      canSelectAll: isAdmin,
      loading,
      select,
    }),
    [units, unitId, isAdmin, loading]
  )

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>
}

export function useUnit() {
  const context = useContext(UnitContext)
  if (!context) throw new Error('useUnit must be used inside UnitProvider')
  return context
}
