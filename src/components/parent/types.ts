// Mirrors api/progress/index.js's parent-students / parent-student-detail
// response shapes. See src/components/progress/types.ts for the shared
// heatmap/weak-spot/session-history/streak shapes these build on.

import type { HeatmapUnit, ParentSessionHistoryEntry, QuizPrepEventSummary, QuizPrepResultSummary, StreakDay, WeakSpot } from '../progress/types'

export interface ParentStudentSummary {
  id: string
  name: string
  current_streak: number
  course_count: number
  last_session_at: string | null
  last_log_at: string | null
  // Phase 10: courses currently within exam_crunch_weeks of their exam.
  crunch_courses: { pack_name: string; days_until_exam: number }[]
}

export interface ParentCourse {
  pack_id: string
  pack_name: string
  exam_date: string
  school_year_start: string
  exam_crunch_weeks: number
  units: HeatmapUnit[]
  weak_spots: WeakSpot[]
  last_log: { logged_at: string; input_method: 'photo' | 'text' | 'checklist' } | null
  active_quiz_prep: QuizPrepEventSummary | null
  quiz_prep_history: QuizPrepResultSummary[]
}

export interface ParentStudentDetailData {
  student: { id: string; name: string }
  streak: { current_streak: number; longest_streak: number }
  courses: ParentCourse[]
  streak_calendar: { days: StreakDay[] }
  session_history: ParentSessionHistoryEntry[]
}
