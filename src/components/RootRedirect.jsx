import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Central post-login/post-reload routing: sends signed-in users to the
// screen for their role, and bounces anyone without a resolvable role.
export default function RootRedirect() {
  const { session, profile, profileError, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading...
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (profileError === 'not_found' || !profile) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ error: 'Account setup incomplete, contact your administrator.' }}
      />
    )
  }

  return <Navigate to={profile.role === 'parent' ? '/parent' : '/home'} replace />
}
