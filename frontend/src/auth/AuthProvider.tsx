import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiRequest, ApiError } from '../api/client'
import { AuthContext, type AuthState, type User } from './authContext'

/** Knows who is signed in. The session itself is an httpOnly cookie the page cannot read. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [welcome, setWelcome] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiRequest<User>('/api/auth/me')
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('signedIn')
      })
      .catch(() => {
        // Not signed in, or the server cannot be reached: practice still works without an account.
        if (!cancelled) setStatus('signedOut')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signedIn = useCallback((me: User, message: string) => {
    setUser(me)
    setStatus('signedIn')
    setWelcome(message)
    return me
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const me = await apiRequest<User>('/api/auth/signin', { method: 'POST', body: { email, password } })
      return signedIn(me, `Welcome back, ${me.name}!`)
    },
    [signedIn],
  )

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const me = await apiRequest<User>('/api/auth/signup', { method: 'POST', body: { name, email, password } })
      return signedIn(me, `Welcome to the academy, ${me.name}!`)
    },
    [signedIn],
  )

  const signOut = useCallback(async () => {
    try {
      await apiRequest<void>('/api/auth/signout', { method: 'POST' })
    } catch (error) {
      // Already signed out on the server: carry on. Anything else: tell the user.
      if (!(error instanceof ApiError && error.status === 401)) throw error
    }
    setUser(null)
    setStatus('signedOut')
    setWelcome(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ status, user, signIn, signUp, signOut, welcome, dismissWelcome: () => setWelcome(null) }),
    [status, user, signIn, signUp, signOut, welcome],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
