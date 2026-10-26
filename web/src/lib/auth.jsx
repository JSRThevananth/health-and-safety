import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { clearToken, getToken, login as apiLogin, me } from './api.js'
import { keepWarm } from './warmup.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const signOut = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  // Restore the session on reload, and drop it if the API rejects the stored token.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    me()
      .then(setUser)
      .catch(signOut)
      .finally(() => setLoading(false))
  }, [signOut])

  useEffect(() => {
    window.addEventListener('qa:unauthorized', signOut)
    return () => window.removeEventListener('qa:unauthorized', signOut)
  }, [signOut])

  // While someone is signed in, keep the API awake so a long inspection never
  // autosaves into a sleeping service.
  useEffect(() => {
    if (!user) return undefined
    return keepWarm()
  }, [user])

  // Re-read the account after a change that alters what the user may do, such as
  // clearing the forced password change.
  const refresh = useCallback(async () => setUser(await me()), [])

  const value = useMemo(
    () => ({
      user,
      loading,
      refresh,
      signIn: async (username, password) => setUser(await apiLogin(username, password)),
      signOut,
    }),
    [user, loading, refresh, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
