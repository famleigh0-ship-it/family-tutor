import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Login() {
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [mode, setMode] = useState('sign-in') // 'sign-in' | 'forgot-password'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(location.state?.error ?? null)
  const [resetSent, setResetSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Navigating imperatively from an effect (rather than rendering
  // <Navigate> directly) avoids a render loop when Supabase fires several
  // auth-state events in quick succession during sign-in.
  useEffect(() => {
    if (session) navigate('/', { replace: true })
  }, [session, navigate])

  if (session) return null

  async function handleSignIn(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setSubmitting(false)
    if (error) setError(error.message)
    // On success, AuthContext picks up the new session and RootRedirect
    // sends the user to /home or /parent based on their role.
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })

    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setResetSent(true)
  }

  return (
    <div className="flex min-h-screen animate-[fadeIn_150ms_ease-in] flex-col justify-center bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900 dark:text-slate-50">
          Family Adaptive Learning Platform
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {mode === 'sign-in' ? 'Sign in to continue' : 'Reset your password'}
        </p>

        {mode === 'sign-in' ? (
          <form onSubmit={handleSignIn} className="mt-8 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
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
              {submitting ? 'Please wait...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleForgotPassword} className="mt-8 space-y-4">
            {resetSent ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                If an account exists for that email, a reset link is on its way.
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
                  />
                </div>

                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {submitting ? 'Sending...' : 'Send reset link'}
                </button>
              </>
            )}
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'forgot-password' : 'sign-in')
            setError(null)
            setResetSent(false)
          }}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center text-center text-sm text-slate-500 underline dark:text-slate-400"
        >
          {mode === 'sign-in' ? 'Forgot password?' : 'Back to sign in'}
        </button>
      </div>
    </div>
  )
}
