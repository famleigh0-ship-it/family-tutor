import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { listCoursePacks } from '../packs/loader.js'

export default function Home() {
  const { session, profile } = useAuth()
  const [streak, setStreak] = useState(0)

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

  const packs = listCoursePacks()

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="FALP" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {profile.name}</h1>

        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
          🔥 {streak} day streak
        </div>

        <div className="mt-6 space-y-3">
          {packs.map((pack) => (
            <Link
              key={pack.id}
              to={`/session/${pack.id}`}
              className="block rounded-lg border border-slate-200 bg-slate-100 px-4 py-5"
            >
              <p className="text-base font-medium text-slate-700">{pack.name}</p>
              <p className="mt-1 text-sm text-slate-500">Course content coming soon</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
