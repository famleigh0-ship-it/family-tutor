import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import TopBar from '../components/TopBar.jsx'
import { SkeletonCard, SkeletonHeatmap } from '../components/Skeleton'
import StudentDetail from '../components/parent/StudentDetail'
import type { ParentStudentDetailData } from '../components/parent/types'
import { useAuth } from '../lib/AuthContext.jsx'
import { clientTimeZone } from '../lib/localDate.js'

export default function ParentStudentDetail() {
  const { studentId } = useParams<{ studentId: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<ParentStudentDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    if (!session || !studentId) return
    const token = session.access_token
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(
          `/api/progress?type=parent-student-detail&student_id=${studentId}&tz=${encodeURIComponent(clientTimeZone())}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const body = await res.json()
        if (cancelled) return

        if (res.status === 403) {
          setForbidden(true)
          return
        }
        if (!res.ok) throw new Error(body.error || 'Failed to load student')
        setDetail(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load student')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [session, studentId])

  useEffect(() => {
    if (forbidden) navigate('/parent', { replace: true, state: { error: 'You are not linked to that student.' } })
  }, [forbidden, navigate])

  return (
    <div className="min-h-screen animate-[fadeIn_150ms_ease-in] bg-slate-50 dark:bg-slate-950">
      <TopBar title="Parent Dashboard" />
      <main className="mx-auto max-w-sm px-4 py-8">
        <Link to="/parent" className="text-sm text-slate-500 underline dark:text-slate-400">
          ← All students
        </Link>

        <div className="mt-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!forbidden && !detail && !error && (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonHeatmap />
            </div>
          )}

          {detail && <StudentDetail detail={detail} />}
        </div>
      </main>
    </div>
  )
}
