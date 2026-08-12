import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient'
import { getAllPacks } from '../packs/loader'

export default function ParentDashboard() {
  const { session } = useAuth()
  const [students, setStudents] = useState(null) // null = loading
  const [lastLogByStudentPack, setLastLogByStudentPack] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: links } = await supabase
        .from('family_links')
        .select('student_id')
        .eq('parent_id', session.user.id)

      const studentIds = (links || []).map((l) => l.student_id)
      if (studentIds.length === 0) {
        if (!cancelled) setStudents([])
        return
      }

      const { data: linkedUsers } = await supabase
        .from('users')
        .select('id, name')
        .in('id', studentIds)

      if (!cancelled) setStudents(linkedUsers || [])

      // Most recent classroom_logs.logged_at per (student, pack) — ordering
      // descending and keeping only the first occurrence per key gives the
      // latest without a separate aggregate query.
      const { data: logs } = await supabase
        .from('classroom_logs')
        .select('user_id, pack_id, logged_at')
        .in('user_id', studentIds)
        .order('logged_at', { ascending: false })

      if (cancelled) return

      const lastLogMap = {}
      for (const log of logs ?? []) {
        const key = `${log.user_id}:${log.pack_id}`
        if (!lastLogMap[key]) lastLogMap[key] = log.logged_at
      }
      setLastLogByStudentPack(lastLogMap)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  const packs = getAllPacks()

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar title="Parent Dashboard" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Parent Dashboard</h1>

        {students === null && <p className="mt-4 text-slate-500">Loading...</p>}
        {students?.length === 0 && (
          <p className="mt-4 text-slate-500">No students linked to this account yet.</p>
        )}

        <div className="mt-4 space-y-3">
          {students?.map((student) => (
            <Link
              key={student.id}
              to={`/parent/${student.id}`}
              className="block rounded-lg border border-slate-200 bg-slate-100 px-4 py-4 text-slate-700"
            >
              <p className="font-medium">{student.name}</p>
              <div className="mt-1 space-y-0.5">
                {packs.map((pack) => {
                  const lastLog = lastLogByStudentPack[`${student.id}:${pack.id}`]
                  return (
                    <p key={pack.id} className="text-xs text-slate-500">
                      {pack.name}: {lastLog ? `logged ${new Date(lastLog).toLocaleDateString()}` : 'no log yet'}
                    </p>
                  )
                })}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
