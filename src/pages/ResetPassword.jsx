import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

// Landing page for the link in Supabase's password-reset email. supabase-js
// detects the recovery token in the URL automatically and starts a
// short-lived recovery session, which updateUser() then upgrades.
export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  // See Login.jsx's friendlyAuthError for why — showing the raw browser
  // error ("Failed to fetch") verbatim is unhelpful; this needs the network
  // the same way signing in does.
  function friendlyAuthError(error) {
    if (!navigator.onLine || /fetch|network/i.test(error.message)) {
      return "You're offline. Check your connection and try again."
    }
    return error.message
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.updateUser({ password })

    setSubmitting(false)
    if (error) {
      setError(friendlyAuthError(error))
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex min-h-screen animate-[fadeIn_150ms_ease-in] flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center dark:bg-slate-950">
        <p className="text-slate-700 dark:text-slate-300">Password updated. You can now sign in.</p>
        <button
          onClick={() => navigate('/login', { replace: true })}
          className="min-h-[44px] rounded-lg bg-slate-900 px-4 py-2 text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Go to login
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen animate-[fadeIn_150ms_ease-in] flex-col justify-center bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900 dark:text-slate-50">Set a new password</h1>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {submitting ? 'Updating...' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
