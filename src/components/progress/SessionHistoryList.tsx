import { useState } from 'react'
import type { ParentSessionHistoryEntry, SessionHistoryEntry, SessionHistoryQuestion } from './types'

interface Props {
  packId: string
  sessions: (SessionHistoryEntry | ParentSessionHistoryEntry)[]
  token: string | undefined
  // Expanding a row calls back into the session-history type with
  // session_id, which is scoped to "the authenticated user's own session"
  // server-side (api/progress/index.js) — a parent can't call it for a
  // student's session, so StudentDetail.tsx passes expandable={false}.
  expandable?: boolean
  showCourseName?: boolean
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  const minutes = Math.round(seconds / 60)
  return `${minutes} min`
}

export default function SessionHistoryList({ packId, sessions, token, expandable = true, showCourseName = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [questionsById, setQuestionsById] = useState<Record<string, SessionHistoryQuestion[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function toggleExpand(session: SessionHistoryEntry | ParentSessionHistoryEntry) {
    if (expandedId === session.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(session.id)
    if (questionsById[session.id] || !token) return

    const sessionPackId = 'pack_id' in session ? session.pack_id : packId
    setLoadingId(session.id)
    try {
      const params = new URLSearchParams({ type: 'session-history', pack_id: sessionPackId, session_id: session.id })
      const res = await fetch(`/api/progress?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json()
      if (res.ok) setQuestionsById((prev) => ({ ...prev, [session.id]: body.questions }))
    } finally {
      setLoadingId(null)
    }
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No sessions yet.</p>
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => {
        const isExpanded = expandedId === session.id
        return (
          <div key={session.id} className="rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => expandable && toggleExpand(session)}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900 dark:text-slate-50">
                  {formatDate(session.started_at)}
                  {showCourseName && 'pack_name' in session ? ` · ${session.pack_name}` : ''}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {formatDuration(session.duration_seconds)} · {session.questions_correct}/{session.questions_attempted} ✓
                </span>
              </div>
              {session.topic_names.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">Topics: {session.topic_names.join(', ')}</p>
              )}
            </button>

            {expandable && isExpanded && (
              <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                {loadingId === session.id && <p className="text-xs text-slate-400">Loading...</p>}
                {questionsById[session.id]?.map((q, i) => (
                  <div key={i} className="border-b border-slate-100 py-2 text-xs last:border-b-0 dark:border-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{q.topic_name}</span>
                      <span className={q.correct === false ? 'text-red-600' : 'text-emerald-600'}>
                        {q.question_type === 'mc' || q.question_type === 'conceptual'
                          ? q.correct
                            ? 'Correct'
                            : 'Incorrect'
                          : `${q.frq_score ?? 0}/4`}
                      </span>
                    </div>
                    {q.question_text && <p className="mt-0.5 text-slate-500 dark:text-slate-400">{q.question_text}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
