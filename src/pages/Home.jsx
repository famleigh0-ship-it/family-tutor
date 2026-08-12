import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { getAllPacks, getPack, getUnit, getTopic, getTopicsForWeek, getUnlockedTopics } from '../packs/loader'

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  return Math.ceil((target - today) / 86_400_000)
}

export default function Home() {
  const { session, profile } = useAuth()
  const [streak, setStreak] = useState(0)
  const [loggedToday, setLoggedToday] = useState({}) // pack_id -> topics_confirmed count

  useEffect(() => {
    let cancelled = false
    supabase
      .from('streaks')
      .select('current_streak')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStreak(data?.current_streak ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  useEffect(() => {
    let cancelled = false

    async function checkLoggedToday() {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const { data } = await supabase
        .from('classroom_logs')
        .select('pack_id, topics_confirmed, logged_at')
        .eq('user_id', session.user.id)
        .gte('logged_at', todayStart.toISOString())

      if (cancelled) return

      const byPack = {}
      for (const row of data ?? []) {
        byPack[row.pack_id] = (row.topics_confirmed ?? []).length
      }
      setLoggedToday(byPack)
    }

    checkLoggedToday()
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    // Exposed for manual testing per the Phase 3 milestone, e.g.
    // getPack('ap-physics-1') or getUnlockedTopics('ap-physics-1', '2026-08-11')
    window.getPack = getPack
    window.getAllPacks = getAllPacks
    window.getUnit = getUnit
    window.getTopic = getTopic
    window.getTopicsForWeek = getTopicsForWeek
    window.getUnlockedTopics = getUnlockedTopics
  }, [])

  const packs = getAllPacks()

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {profile.name}</h1>

        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
          🔥 {streak} day streak
        </div>

        <div className="mt-6 space-y-3">
          {packs.map((pack) => {
            const days = daysUntil(pack.exam_date)
            const topicsLoggedCount = loggedToday[pack.id]

            return (
              <div key={pack.id} className="space-y-2">
                <Link
                  to={`/session/${pack.id}`}
                  className="block rounded-lg border border-slate-200 bg-slate-100 px-4 py-5"
                >
                  <p className="text-base font-medium text-slate-700">{pack.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{pack.units.length} units</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {days >= 0 ? `${days} days until exam` : 'Exam date passed'}
                  </p>
                </Link>

                {topicsLoggedCount !== undefined ? (
                  <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    Logged ✓ — {topicsLoggedCount} topic{topicsLoggedCount === 1 ? '' : 's'} today
                  </div>
                ) : (
                  <Link
                    to={`/log/${pack.id}`}
                    className="block rounded-lg border border-dashed border-slate-300 px-4 py-3"
                  >
                    <span className="text-sm font-medium text-slate-700">{pack.name}</span>
                    <span className="block text-sm text-slate-500">What did you cover today? 📝</span>
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
