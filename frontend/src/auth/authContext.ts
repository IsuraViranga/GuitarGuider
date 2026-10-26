import { createContext, useContext } from 'react'

export type User = { id: string; name: string; email: string; role: 'user' | 'admin' }

export type AuthState = {
  /** 'loading' only while the app first asks the server who is signed in. */
  status: 'loading' | 'signedOut' | 'signedIn'
  user: User | null
  signIn: (email: string, password: string) => Promise<User>
  signUp: (name: string, email: string, password: string) => Promise<User>
  signOut: () => Promise<void>
  /** Sets a new password with the emailed link's key, and signs in. */
  resetPassword: (token: string, password: string) => Promise<User>
  /** "Welcome, Isura!" after signing in or up, until it is dismissed. */
  welcome: string | null
  dismissWelcome: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}

/** "Isura Perera" → "IP", "Melantha" → "M", "ඉසුරු පෙරේරා" → "ඉප". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((word) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word))[0]?.segment ?? '').join('').toUpperCase()
}
