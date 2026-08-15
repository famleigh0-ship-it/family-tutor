export type SessionErrorKind = 'bank-empty' | 'grading-timeout' | 'network' | 'session-load'

interface Props {
  kind: SessionErrorKind
  message?: string
  onRetry?: () => void
  onSkip?: () => void
  onBackHome?: () => void
}

const DEFAULT_MESSAGES: Record<SessionErrorKind, string> = {
  'bank-empty': 'Having trouble loading questions. Please try again in a few minutes.',
  'grading-timeout': 'Taking longer than usual to grade. Try submitting again.',
  network: 'Connection issue. Your progress is saved.',
  'session-load': 'Something went wrong loading your session.'
}

// bank-empty auto-retries in the background (see Session.tsx) — this soft,
// non-alarming state is what shows up while that's happening, before the
// retry budget is exhausted.
export function BankLoadingNotice() {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-6 text-center dark:border-slate-800">
      <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300" />
      <p className="text-base font-medium text-slate-900 dark:text-slate-50">Getting your questions ready...</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">This takes a moment the first time.</p>
    </div>
  )
}

export default function SessionError({ kind, message, onRetry, onSkip, onBackHome }: Props) {
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 text-center dark:border-slate-800">
      <p className="text-base font-medium text-slate-900 dark:text-slate-50">{message ?? DEFAULT_MESSAGES[kind]}</p>

      <div className="space-y-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Retry
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900 dark:border-slate-700 dark:text-slate-100"
          >
            Skip this question
          </button>
        )}
        {onBackHome && (
          <button type="button" onClick={onBackHome} className="w-full text-center text-sm text-slate-500 underline dark:text-slate-400">
            Back to Home
          </button>
        )}
      </div>
    </div>
  )
}
