import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar.jsx'
import { SkeletonCard } from '../components/Skeleton'
import StudentCard from '../components/parent/StudentCard'
import type { ParentStudentSummary } from '../components/parent/types'
import { useAuth } from '../lib/AuthContext.jsx'

export default function ParentDashboard() {
  const { session } = useAuth()
  const [students, setStudents] = useState<ParentStudentSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    const token = session.access_token
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/progress?type=parent-students', {
          headers: { Authorization: `Bearer ${token}` }
        })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error || 'Failed to load students')
        setStudents(body.students)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load students')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [session])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TopBar title="Parent Dashboard" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Family Dashboard</h1>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-3">
          {students === null && (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {students?.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">No students linked to this account yet.</p>
          )}

          {students?.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </div>
      </main>
    </div>
  )
}
