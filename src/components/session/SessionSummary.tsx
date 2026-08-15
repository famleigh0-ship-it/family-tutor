import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import type { AnsweredResult, SessionTopic } from './types'

interface TopicAfter {
  id: string
  name: string
  mastery_score: number
  mastery_label: string
}

interface Props {
  packId: string
  mode: string
  durationSeconds: number
  questionsAttempted: number
  questionsCorrect: number
  currentStreak: number
  topicsBefore: SessionTopic[]
  topicsAfter: TopicAfter[]
  answeredResults: AnsweredResult[]
  onBackHome: () => void
}

// mastery-summary's unit shape — see api/progress/index.js's
// buildMasterySummaryUnits (same endpoint Progress.tsx already uses).
interface MasterySummaryTopic {
  unlocked: boolean
  mastery_score: number
}
interface MasterySummaryUnit {
  ap_exam_weight_min: number
  ap_exam_weight_max: number
  topics: MasterySummaryTopic[]
}

const EXAM_READY_THRESHOLD = 0.8 // "Solid" tier, matches getMasteryLabel

function movementArrow(before: number, after: number) {
  if (after > before + 0.001) return '↑'
  if (after < before - 0.001) return '↓'
  return '→'
}

export default function SessionSummary({
  packId,
  mode,
  durationSeconds,
  questionsAttempted,
  questionsCorrect,
  currentStreak,
  topicsBefore,
  topicsAfter,
  answeredResults,
  onBackHome
}: Props) {
  const isCrunch = mode === 'exam-crunch'
  const [examReadiness, setExamReadiness] = useState<{ percent: number; needsWork: number } | null>(null)

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
    // InstallPrompt.tsx's "2+ sessions" gate — sessions/mastery_records
    // have no RLS policy for the client to read a real count directly
    // (same reasoning as the falp:sessionComplete write above).
    const priorCount = Number(localStorage.getItem('falp:totalSessionsCompleted') ?? '0')
    localStorage.setItem('falp:totalSessionsCompleted', String(priorCount + 1))
    // Only ever needs to run once, when the summary first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phase 10 exam-crunch: "AP exam readiness" replaces "Nice work on" —
  // weighted average of mastery_score across all unlocked topics (weight =
  // each topic's unit ap_exam_weight_mid, so high-weight units naturally
  // dominate without an arbitrary cutoff), plus a count of unlocked topics
  // still below the "Solid" tier. Fetches the same mastery-summary endpoint
  // Progress.tsx already uses.
  useEffect(() => {
    if (!isCrunch) return
    let cancelled = false

    async function loadReadiness() {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      try {
        const res = await fetch(`/api/progress?type=mastery-summary&pack_id=${packId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const body = await res.json()
        if (cancelled || !res.ok) return

        const units = (body.units ?? []) as MasterySummaryUnit[]
        let weightedTotal = 0
        let weightSum = 0
        let needsWork = 0

        for (const unit of units) {
          const weight = (unit.ap_exam_weight_min + unit.ap_exam_weight_max) / 2
          for (const topic of unit.topics) {
            if (!topic.unlocked) continue
            weightedTotal += topic.mastery_score * weight
            weightSum += weight
            if (topic.mastery_score < EXAM_READY_THRESHOLD) needsWork++
          }
        }

        if (weightSum > 0) {
          setExamReadiness({ percent: Math.round((weightedTotal / weightSum) * 100), needsWork })
        }
      } catch {
        // Readiness is a nice-to-have on this screen — a failed fetch just
        // means the normal "Nice work on" block stays visible instead.
      }
    }

    loadReadiness()
    return () => {
      cancelled = true
    }
  }, [isCrunch, packId])

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

      {isCrunch && examReadiness ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">AP exam readiness</p>
          <p className="mt-1 text-2xl font-semibold text-red-800 dark:text-red-200">{examReadiness.percent}%</p>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            Topics still needing work before exam: {examReadiness.needsWork}
          </p>
        </div>
      ) : (
        niceWorkOn && (
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Nice work on</p>
            <p className="mt-1 text-base text-slate-900 dark:text-slate-50">{niceWorkOn.name}</p>
          </div>
        )
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

      <Link to={`/progress/${packId}`} className="block text-sm text-slate-500 underline dark:text-slate-400">
        View your progress →
      </Link>
    </div>
  )
}
