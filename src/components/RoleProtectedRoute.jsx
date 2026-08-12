import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Navigates imperatively from an effect rather than rendering <Navigate>
// directly, since re-rendering a fresh <Navigate> element on every auth
// state change can trigger a "Maximum update depth exceeded" render loop.
export default function RoleProtectedRoute({ allowedRole, children }) {
  const { session, profile, profileError, loading } = useAuth()
  const navigate = useNavigate()

  const denied = !loading && (!session || profileError === 'not_found' || !profile || profile.role !== allowedRole)

  useEffect(() => {
    if (loading) return

    if (!session) {
      navigate('/login', { replace: true })
    } else if (profileError === 'not_found' || !profile) {
      navigate('/login', {
        replace: true,
        state: { error: 'Account setup incomplete, contact your administrator.' }
      })
    } else if (profile.role !== allowedRole) {
      navigate('/login', { replace: true, state: { error: "You don't have access to that page." } })
    }
  }, [loading, session, profile, profileError, allowedRole, navigate])

  if (loading || denied) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading...
      </div>
    )
  }

  return children
}
