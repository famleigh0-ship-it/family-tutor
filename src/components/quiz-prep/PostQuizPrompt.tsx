import { useState } from 'react'
import { useAuth } from '../../lib/AuthContext.jsx'

interface Props {
  eventId: string
  topicNames: string[]
  onDone: () => void
}

type Result = 'good' | 'okay' | 'rough' | 'skipped'

const SKIP_LIMIT = 3

const OPTIONS: { result: Result; emoji: string; label: string }[] = [
  { result: 'good', emoji: '😊', label: 'Good' },
  { result: 'okay', emoji: '😐', label: 'Okay' },
  { result: 'rough', emoji: '😟', label: 'Rough' }
]

function skipKey(eventId: string) {
  return `falp:quizPrepSkips:${eventId}`
}

// Modal overlaid on Home, not a full-screen route — "not blocking
// navigation" per the Phase 8 spec means the student can dismiss it and
// keep using Home, not that it renders alongside other content.
export default function PostQuizPrompt({ eventId, topicNames, onDone }: Props) {
  const { session } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitResult(result: Result) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/quiz-prep', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ event_id: eventId, result })
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save result')
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  // A 3rd skip has to actually persist server-side (result: 'skipped') —
  // otherwise startSession's post-quiz gate would keep firing forever,
  // since it's driven by post_quiz_result being null in the database, not
  // by anything client-side. The first two skips just close the modal;
  // the gate returns next time the student tries to start a session.
  function handleSkip() {
    const key = skipKey(eventId)
    const count = Number(localStorage.getItem(key) ?? '0') + 1

    if (count >= SKIP_LIMIT) {
      localStorage.removeItem(key)
      submitResult('skipped')
    } else {
      localStorage.setItem(key, String(count))
      onDone()
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 [animation:slideUp_200ms_ease-out] dark:bg-slate-900">
        <p className="text-lg font-medium text-slate-900 dark:text-slate-50">How did your quiz go?</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{topicNames.join(', ')}</p>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-5 grid grid-cols-3 gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.result}
              type="button"
              disabled={submitting}
              onClick={() => submitResult(opt.result)}
              className="flex min-h-[44px] flex-col items-center gap-1 rounded-lg border border-slate-200 py-4 text-sm font-medium text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-100"
            >
              <span className="text-2xl">{opt.emoji}</span>
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={handleSkip}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center text-center text-sm text-slate-500 underline disabled:opacity-50 dark:text-slate-400"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
