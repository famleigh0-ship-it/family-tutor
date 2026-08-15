import { useEffect, useMemo } from 'react'
import type { AnsweredResult, SessionTopic } from './types'

interface TopicAfter {
  id: string
  name: string
  mastery_score: number
  mastery_label: string
}

interface Props {
  packId: string
  durationSeconds: number
  questionsAttempted: number
  questionsCorrect: number
  currentStreak: number
  topicsBefore: SessionTopic[]
  topicsAfter: TopicAfter[]
  answeredResults: AnsweredResult[]
  onBackHome: () => void
}

function movementArrow(before: number, after: number) {
  if (after > before + 0.001) return '↑'
  if (after < before - 0.001) return '↓'
  return '→'
}

export default function SessionSummary({
  packId,
  durationSeconds,
  questionsAttempted,
  questionsCorrect,
  currentStreak,
  topicsBefore,
  topicsAfter,
  answeredResults,
  onBackHome
}: Props) {
  const beforeById = useMemo(() => new Map(topicsBefore.map((t) => [t.id, t])), [topicsBefore])

  const niceWorkOn = useMemo(() => {
    const byTopic = new Map<string, { name: string; total: number; count: number }>()
    for (const r of answeredResults) {
      const score = r.frq_score !== null ? r.frq_score / 4 : r.correct ? 1 : 0
      const entry = byTopic.get(r.topic_id) ?? { name: r.topic_name, total: 0, count: 0 }
      entry.total += score
      entry.count += 1
      byTopic.set(r.topic_id, entry)
    }
    let best: { name: string; avg: number } | null = null
    for (const entry of byTopic.values()) {
      const avg = entry.total / entry.count
      if (!best || avg > best.avg) best = { name: entry.name, avg }
    }
    return best
  }, [answeredResults])

  const focusNextTime = useMemo(() => {
    if (topicsAfter.length === 0) return null
    return topicsAfter.reduce((lowest, t) => (t.mastery_score < lowest.mastery_score ? t : lowest), topicsAfter[0])
  }, [topicsAfter])

  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    localStorage.setItem(
      `falp:sessionComplete:${packId}`,
      JSON.stringify({
        date: todayStr,
        topicName: niceWorkOn?.name ?? topicsAfter[0]?.name ?? null,
        masteryLabel: topicsAfter[0]?.mastery_label ?? null
      })
    )
    // Only ever needs to run once, when the summary first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto max-w-sm space-y-6 px-4 py-10 text-center">
      <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Session Complete! 🎉</p>

      <div className="space-y-1.5 text-base text-slate-700 dark:text-slate-300">
        <p>⏱ {Math.round(durationSeconds / 60)} minutes</p>
        <p>
          ✓ {questionsCorrect} of {questionsAttempted} correct
        </p>
        <p>🔥 Streak: {currentStreak} day{currentStreak === 1 ? '' : 's'}</p>
      </div>

      {topicsAfter.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4 text-left dark:border-slate-800">
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Topics practiced</p>
          <div className="mt-2 space-y-1.5">
            {topicsAfter.map((t) => {
              const before = beforeById.get(t.id)
              const arrow = before ? movementArrow(before.mastery_score, t.mastery_score) : '→'
              return (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-900 dark:text-slate-50">{t.name}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {arrow} {t.mastery_label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {niceWorkOn && (
        <div className="text-left">
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Nice work on</p>
          <p className="mt-1 text-base text-slate-900 dark:text-slate-50">{niceWorkOn.name}</p>
        </div>
      )}

      {focusNextTime && (
        <div className="text-left">
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Focus next time</p>
          <p className="mt-1 text-base text-slate-900 dark:text-slate-50">{focusNextTime.name}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onBackHome}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Back to Home
      </button>
    </div>
  )
}
