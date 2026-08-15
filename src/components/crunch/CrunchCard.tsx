import { Link } from 'react-router-dom'

interface Priority {
  topic_name: string
  mastery_label: string
}

interface Props {
  packId: string
  packName: string
  daysUntilExam: number
  examCrunchWeeks: number
  priorities: Priority[]
}

const PULSE_THRESHOLD_DAYS = 14

// Home.jsx renders this in place of the normal course card once a course
// enters crunch (daysUntilExam <= examCrunchWeeks*7, same condition
// session-mode.js's detectSessionMode uses). Priorities are fetched by
// Home.jsx from the existing /api/progress?type=weak-spots endpoint
// (already exam-weight-aware — see api/progress/index.js's buildWeakSpots)
// and passed down, the same presentational-component pattern
// quiz-prep/QuizPrepCard.tsx already uses.
export default function CrunchCard({ packId, packName, daysUntilExam, examCrunchWeeks, priorities }: Props) {
  const totalCrunchDays = examCrunchWeeks * 7
  const fillFraction = totalCrunchDays > 0 ? Math.min(1, Math.max(0, 1 - daysUntilExam / totalCrunchDays)) : 1
  const pulse = daysUntilExam < PULSE_THRESHOLD_DAYS

  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
      <p className="text-base font-semibold text-red-800 dark:text-red-200">
        🔴 {packName} — CRUNCH MODE
      </p>

      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">
        Exam in {daysUntilExam} day{daysUntilExam === 1 ? '' : 's'}
      </p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-red-100 dark:bg-red-900/50">
        <div
          className={`h-full rounded-full bg-red-600 transition-all dark:bg-red-500 ${pulse ? 'animate-pulse' : ''}`}
          style={{ width: `${Math.round(fillFraction * 100)}%` }}
        />
      </div>

      {priorities.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">Top priorities:</p>
          <ul className="mt-1 space-y-0.5">
            {priorities.map((p) => (
              <li key={p.topic_name} className="text-sm text-red-700 dark:text-red-300">
                • {p.topic_name} (mastery: {p.mastery_label})
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        to={`/session/${packId}`}
        className="mt-3 block w-full rounded-lg bg-red-700 px-4 py-2.5 text-center text-base font-medium text-white dark:bg-red-600"
      >
        Start Crunch Session
      </Link>
    </div>
  )
}
