import { Link } from 'react-router-dom'
import LastLogStatus from './LastLogStatus'
import type { ParentStudentSummary } from './types'

interface Props {
  student: ParentStudentSummary
}

function formatLastSession(iso: string | null) {
  if (!iso) return 'No sessions yet'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default function StudentCard({ student }: Props) {
  return (
    <Link
      to={`/parent/${student.id}`}
      className="block rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <p className="text-base font-semibold text-slate-900 dark:text-slate-50">{student.name}</p>
      <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span>🔥 {student.current_streak} day{student.current_streak === 1 ? '' : 's'}</span>
        <span>📚 {student.course_count} course{student.course_count === 1 ? '' : 's'}</span>
      </div>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Last session: {formatLastSession(student.last_session_at)}</p>
      <LastLogStatus lastLogAt={student.last_log_at} />

      {student.crunch_courses.length > 0 && (
        <div className="mt-2 space-y-1">
          {student.crunch_courses.map((c) => (
            <p
              key={c.pack_name}
              className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              ⚠ {c.pack_name} crunch: {c.days_until_exam} day{c.days_until_exam === 1 ? '' : 's'}
            </p>
          ))}
        </div>
      )}

      <span className="mt-2 inline-block text-sm font-medium text-slate-700 underline dark:text-slate-300">View Detail →</span>
    </Link>
  )
}
