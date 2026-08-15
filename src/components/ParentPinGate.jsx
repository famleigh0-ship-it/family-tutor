import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { checkPinStatus, setParentPin, verifyParentPin } from '../lib/parentPin.js'

const STORAGE_KEY = 'falp_parent_pin_verified_at'
const TIMEOUT_MS = 30 * 60 * 1000
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll']
const ACTIVITY_THROTTLE_MS = 30 * 1000
const CHECK_INTERVAL_MS = 30 * 1000

function readVerifiedAt() {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  return raw ? Number(raw) : null
}

function writeVerifiedAt(ts) {
  sessionStorage.setItem(STORAGE_KEY, String(ts))
}

function clearVerifiedAt() {
  sessionStorage.removeItem(STORAGE_KEY)
}

// Gates access to /parent routes with a 4-digit PIN, separate from the
// Supabase Auth login. Unlock state lives in sessionStorage (so it resets
// every browser session) and re-locks after 30 minutes of inactivity
// without signing the user out of Supabase Auth.
export default function ParentPinGate({ children }) {
  const { session } = useAuth()
  const [unlocked, setUnlocked] = useState(() => {
    const ts = readVerifiedAt()
    return ts !== null && Date.now() - ts < TIMEOUT_MS
  })
  const [hasPin, setHasPin] = useState(null) // null = loading
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (unlocked) return
    let cancelled = false
    checkPinStatus(session)
      .then(({ hasPin: exists }) => {
        if (!cancelled) setHasPin(exists)
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the server. Try again.')
      })
    return () => {
      cancelled = true
    }
  }, [unlocked, session])

  const bumpActivity = useCallback(() => {
    const now = Date.now()
    if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return
    lastActivityRef.current = now
    writeVerifiedAt(now)
  }, [])

  useEffect(() => {
    if (!unlocked) return

    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, bumpActivity)

    const interval = setInterval(() => {
      const ts = readVerifiedAt()
      if (ts === null || Date.now() - ts >= TIMEOUT_MS) {
        clearVerifiedAt()
        setHasPin(null)
        setUnlocked(false)
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, bumpActivity)
      clearInterval(interval)
    }
  }, [unlocked, bumpActivity])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.')
      return
    }

    setSubmitting(true)
    try {
      if (!hasPin) {
        if (pin !== confirmPin) {
          setError('PINs do not match.')
          setSubmitting(false)
          return
        }
        await setParentPin(session, pin)
      } else {
        const { ok } = await verifyParentPin(session, pin)
        if (!ok) {
          setError('Incorrect PIN.')
          setSubmitting(false)
          return
        }
      }
      const now = Date.now()
      lastActivityRef.current = now
      writeVerifiedAt(now)
      setUnlocked(true)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  if (unlocked) return children

  if (hasPin === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen animate-[fadeIn_150ms_ease-in] flex-col justify-center bg-slate-50 px-6 py-12 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold text-slate-900 dark:text-slate-50">
          {hasPin ? 'Enter your PIN' : 'Set a PIN'}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {hasPin
            ? 'Enter your 4-digit PIN to access the parent dashboard.'
            : 'Choose a 4-digit PIN to protect the parent dashboard.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <input
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            required
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="----"
            aria-label={hasPin ? 'PIN' : 'New PIN'}
            className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
          />

          {!hasPin && (
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="confirm"
              aria-label="Confirm PIN"
              className="w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {submitting ? 'Please wait...' : hasPin ? 'Unlock' : 'Set PIN'}
          </button>
        </form>
      </div>
    </div>
  )
}
