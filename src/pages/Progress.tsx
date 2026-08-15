import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { SkeletonBlock, SkeletonHeatmap } from '../components/Skeleton'
import ExamCountdown from '../components/progress/ExamCountdown'
import MasteryHeatmap from '../components/progress/MasteryHeatmap'
import WeakSpotCard from '../components/progress/WeakSpotCard'
import SessionHistoryList from '../components/progress/SessionHistoryList'
import StreakCalendar from '../components/progress/StreakCalendar'
import type { HeatmapUnit, SessionHistoryEntry, StreakDay, WeakSpot } from '../components/progress/types'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { getPack } from '../packs/loader'

export default function Progress() {
  const { packId } = useParams<{ packId: string }>()
  const { session } = useAuth()

  const [streak, setStreak] = useState<{ current: number; longest: number } | null>(null)
  const [units, setUnits] = useState<HeatmapUnit[] | null>(null)
  const [weakSpots, setWeakSpots] = useState<WeakSpot[] | null>(null)
  const [sessions, setSessions] = useState<SessionHistoryEntry[] | null>(null)
  const [streakDays, setStreakDays] = useState<StreakDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  let pack = null
  try {
    pack = packId ? getPack(packId) : null
  } catch {
    pack = null
  }

  useEffect(() => {
    if (!session) return
    let cancelled = false

    supabase
      .from('streaks')
      .select('current_streak, longest_streak')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStreak({ current: data?.current_streak ?? 0, longest: data?.longest_streak ?? 0 })
      })

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!packId || !session) return
    const token = session.access_token
    let cancelled = false

    async function load() {
      const authHeader = { Authorization: `Bearer ${token}` }

      try {
        const [masteryRes, weakSpotRes, sessionRes, streakRes] = await Promise.all([
          fetch(`/api/progress?type=mastery-summary&pack_id=${packId}`, { headers: authHeader }),
          fetch(`/api/progress?type=weak-spots&pack_id=${packId}`, { headers: authHeader }),
          fetch(`/api/progress?type=session-history&pack_id=${packId}&limit=10`, { headers: authHeader }),
          fetch(`/api/progress?type=streak-calendar&pack_id=${packId}`, { headers: authHeader })
        ])

        const [masteryBody, weakSpotBody, sessionBody, streakBody] = await Promise.all([
          masteryRes.json(),
          weakSpotRes.json(),
          sessionRes.json(),
          streakRes.json()
        ])

        if (cancelled) return
        if (!masteryRes.ok) throw new Error(masteryBody.error || 'Failed to load mastery data')

        setUnits(masteryBody.units)
        setWeakSpots(weakSpotRes.ok ? weakSpotBody.weak_spots : [])
        setSessions(sessionRes.ok ? sessionBody.sessions : [])
        setStreakDays(streakRes.ok ? streakBody.days : [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load progress')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [packId, session])

  if (!pack || !packId) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <TopBar title="FALP" />
        <main className="mx-auto max-w-sm px-4 py-8">
          <p className="text-slate-500 dark:text-slate-400">Unknown course.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen animate-[fadeIn_150ms_ease-in] bg-slate-50 dark:bg-slate-950">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm space-y-6 px-4 py-8">
        <div>
          <Link to="/home" className="text-sm text-slate-500 underline dark:text-slate-400">
            ← Home
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">{pack.name} Progress</h1>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          {streak === null ? (
            <SkeletonBlock className="h-7 w-32" />
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700 dark:bg-orange-950 dark:text-orange-300">
              🔥 {streak.current} day streak
            </span>
          )}
        </div>

        <ExamCountdown packName={pack.name} examDate={pack.exam_date} schoolYearStart={pack.school_year_start} />

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Mastery by Topic
          </h2>
          {units === null ? <SkeletonHeatmap /> : <MasteryHeatmap packId={packId} units={units} />}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Focus Areas</h2>
          {weakSpots === null ? <SkeletonBlock className="h-40" /> : <WeakSpotCard packId={packId} weakSpots={weakSpots} />}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recent Sessions
          </h2>
          {sessions === null ? (
            <SkeletonBlock className="h-32" />
          ) : (
            <SessionHistoryList packId={packId} sessions={sessions} token={session?.access_token} />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Activity</h2>
          {streakDays === null ? (
            <SkeletonBlock className="h-24" />
          ) : (
            <StreakCalendar days={streakDays} currentStreak={streak?.current ?? 0} longestStreak={streak?.longest ?? 0} />
          )}
        </section>
      </main>
    </div>
  )
}
