import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

/** @typedef {{ id: string, name: string, role: 'student' | 'parent' }} Profile */
/**
 * @typedef {{
 *   session: import('@supabase/supabase-js').Session | null | undefined,
 *   profile: Profile | null | undefined,
 *   profileError: string | null,
 *   loading: boolean
 * }} AuthContextValue
 */

/** @type {import('react').Context<AuthContextValue | null>} */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [profile, setProfile] = useState(undefined) // undefined = loading, null = none found
  const [profileError, setProfileError] = useState(null)
  const requestIdRef = useRef(0)

  const loadProfile = useCallback(async (userId) => {
    const requestId = ++requestIdRef.current

    if (!userId) {
      if (requestId === requestIdRef.current) {
        setProfile(null)
        setProfileError(null)
      }
      return
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, name, role')
      .eq('id', userId)
      .maybeSingle()

    // A newer request has since started (e.g. another auth-state event
    // fired before this one resolved) — don't let a stale response
    // clobber more recent state.
    if (requestId !== requestIdRef.current) return

    if (error) {
      setProfile(null)
      setProfileError(error.message)
    } else if (!data) {
      setProfile(null)
      setProfileError('not_found')
    } else {
      setProfile(data)
      setProfileError(null)
    }
  }, [])

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session as soon
    // as it's subscribed to (Supabase v2), so a separate getSession() call
    // is redundant and was a real race: it could resolve after a sign-in
    // event and overwrite the correct session with stale data.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      // Reset profile to "loading" for the new session rather than leaving
      // it at whatever the previous session's profile was. Without this,
      // `loading` below could read false (profile !== undefined, just
      // stale) while the fetch for the new session is still in flight —
      // RootRedirect would then treat that stale value as "no profile
      // exists" and bounce to /login, which immediately bounces back since
      // the session is in fact valid, looping until the real fetch resolves.
      setProfile(undefined)
      loadProfile(newSession?.user?.id)
    })

    return () => listener.subscription.unsubscribe()
  }, [loadProfile])

  const loading = session === undefined || (Boolean(session) && profile === undefined)

  return (
    <AuthContext.Provider value={{ session, profile, profileError, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
