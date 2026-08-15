// Mirrors api/progress/index.js's response shapes. Shared between the
// student Progress page and the parent detail view (StudentDetail.tsx),
// which both render the same heatmap/weak-spot/session-history/streak
// components against read-only vs. interactive variants of this data.

export type MasteryTier = 'none' | 'developing' | 'practicing' | 'solid' | 'mastered'

export interface HeatmapTopic {
  id: string
  name: string
  type: 'conceptual' | 'quantitative' | 'mixed'
  difficulty: 1 | 2 | 3
  input_mode: 'typed' | 'photo'
  bc_only: boolean
  unlocked: boolean
  mastery_score: number
  attempts: number
  last_seen: string | null
  tier: MasteryTier
  label: string
}

export interface HeatmapUnit {
  id: string
  name: string
  ap_exam_weight_min: number
  ap_exam_weight_max: number
  topics: HeatmapTopic[]
}

export interface WeakSpot {
  topic_id: string
  topic_name: string
  unit_name: string
  mastery_score: number
  mastery_label: string
  attempts: number
  days_since_seen: number | null
  score: number
}

export interface SessionHistoryEntry {
  id: string
  started_at: string
  duration_seconds: number | null
  questions_attempted: number
  questions_correct: number
  topic_names: string[]
}

export interface ParentSessionHistoryEntry extends SessionHistoryEntry {
  pack_id: string
  pack_name: string
}

export interface SessionHistoryQuestion {
  topic_name: string
  question_type: 'mc' | 'frq' | 'conceptual'
  question_text: string | null
  correct: boolean | null
  frq_score: number | null
}

export interface StreakDay {
  date: string
  active: boolean
}

export interface QuizPrepEventSummary {
  id: string
  pack_id: string
  topic_names: string[]
  quiz_date: string
  days_until_quiz: number
}

export interface QuizPrepResultSummary {
  id: string
  topic_names: string[]
  quiz_date: string
  post_quiz_result: 'good' | 'okay' | 'rough' | 'skipped'
}
