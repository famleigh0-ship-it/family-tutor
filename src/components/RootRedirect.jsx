import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Central post-login/post-reload routing: sends signed-in users to the
// screen for their role, and bounces anyone without a resolvable role.
// Navigates imperatively from an effect rather than rendering <Navigate>
// directly, since re-rendering a fresh <Navigate> element on every auth
// state change can trigger a "Maximum update depth exceeded" render loop.
export default function RootRedirect() {
  const { session, profile, profileError, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return

    if (!session) {
      navigate('/login', { replace: true })
    } else if (profileError === 'not_found' || !profile) {
      navigate('/login', {
        replace: true,
        state: { error: 'Account setup incomplete, contact your administrator.' }
      })
    } else {
      navigate(profile.role === 'parent' ? '/parent' : '/home', { replace: true })
    }
  }, [loading, session, profile, profileError, navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
      Loading...
    </div>
  )
}
