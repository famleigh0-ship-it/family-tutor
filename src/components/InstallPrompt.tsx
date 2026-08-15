import { useEffect, useState } from 'react'

const DISMISS_STORAGE_KEY = 'falp:installPromptDismissedAt'
const INSTALLED_STORAGE_KEY = 'falp:installed'
const SESSIONS_COMPLETED_KEY = 'falp:totalSessionsCompleted'
const DISMISS_SNOOZE_DAYS = 7
const MIN_SESSIONS_BEFORE_PROMPT = 2

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function isMobileViewport() {
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const narrowViewport = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches
  return mobileUA || narrowViewport
}

function isAlreadyInstalled() {
  const standalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    // iOS Safari's own non-standard flag — no matchMedia equivalent there.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return standalone || localStorage.getItem(INSTALLED_STORAGE_KEY) === 'true'
}

function isSnoozed() {
  const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
  if (!raw) return false
  const dismissedAt = Number(raw)
  if (!Number.isFinite(dismissedAt)) return false
  return Date.now() - dismissedAt < DISMISS_SNOOZE_DAYS * 24 * 60 * 60 * 1000
}

function sessionsCompleted() {
  return Number(localStorage.getItem(SESSIONS_COMPLETED_KEY) ?? '0')
}

// Non-intrusive "Add to home screen" banner shown at the bottom of /home,
// mobile only, once the student has completed 2+ sessions
// (SESSIONS_COMPLETED_KEY is incremented by SessionSummary.tsx on mount —
// sessions/mastery_records have no RLS policy for the client to read a
// real count directly, same reasoning as Home.jsx's other localStorage-
// sourced state like falp:sessionComplete:*).
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    function onAppInstalled() {
      localStorage.setItem(INSTALLED_STORAGE_KEY, 'true')
      setHidden(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  if (hidden) return null
  if (isAlreadyInstalled()) return null
  if (!isMobileViewport()) return null
  if (sessionsCompleted() < MIN_SESSIONS_BEFORE_PROMPT) return null
  if (isSnoozed()) return null
  if (!isIOS() && !deferredPrompt) return null // Android/Chrome: nothing to trigger yet

  function handleNotNow() {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()))
    setHidden(true)
  }

  async function handleAdd() {
    if (isIOS()) {
      setShowIOSInstructions(true)
      return
    }
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      localStorage.setItem(INSTALLED_STORAGE_KEY, 'true')
    }
    setDeferredPrompt(null)
    setHidden(true)
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-sm items-center gap-3">
          <p className="flex-1 text-sm text-slate-700 dark:text-slate-300">📱 Add to home screen for quicker access</p>
          <button
            type="button"
            onClick={handleNotNow}
            className="min-h-[44px] rounded-lg px-3 py-2 text-sm font-medium text-slate-500 dark:text-slate-400"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleAdd}
            className="min-h-[44px] rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Add
          </button>
        </div>
      </div>

      {showIOSInstructions && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 [animation:slideUp_200ms_ease-out] dark:bg-slate-900">
            <p className="text-base font-medium text-slate-900 dark:text-slate-50">Add to Home Screen</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Tap <span className="font-semibold">Share</span> in Safari's toolbar, then{' '}
              <span className="font-semibold">Add to Home Screen</span>.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowIOSInstructions(false)
                setHidden(true)
              }}
              className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
