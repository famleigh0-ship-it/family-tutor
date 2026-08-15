import SessionHistoryList from '../progress/SessionHistoryList'
import StreakCalendar from '../progress/StreakCalendar'
import CourseProgress from './CourseProgress'
import type { ParentStudentDetailData } from './types'

interface Props {
  detail: ParentStudentDetailData
}

export default function StudentDetail({ detail }: Props) {
  const { student, streak, courses, streak_calendar, session_history } = detail

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{student.name}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          🔥 {streak.current_streak} day{streak.current_streak === 1 ? '' : 's'} · Best {streak.longest_streak}
        </p>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Not enrolled in any courses yet.</p>
      ) : (
        <div className="space-y-4">
          {courses.map((course) => (
            <CourseProgress key={course.pack_id} course={course} />
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Activity</p>
        <StreakCalendar days={streak_calendar.days} currentStreak={streak.current_streak} longestStreak={streak.longest_streak} />
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Recent Sessions</p>
        {/* Read-only: session detail expansion needs the student's own
            auth token server-side (api/progress/index.js's session-history
            type only authorizes the session's owner), which the parent
            doesn't have — so this list stays summary-only here. */}
        <SessionHistoryList packId="" sessions={session_history} token={undefined} expandable={false} showCourseName />
      </div>
    </div>
  )
}
