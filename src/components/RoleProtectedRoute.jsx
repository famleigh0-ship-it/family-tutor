import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

export default function RoleProtectedRoute({ allowedRole, children }) {
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

  if (profile.role !== allowedRole) {
    return (
      <Navigate to="/login" replace state={{ error: "You don't have access to that page." }} />
    )
  }

  return children
}
