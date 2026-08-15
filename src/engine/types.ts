import type { Topic } from '../packs/types'

export type SessionMode = 'onboarding' | 'adaptive' | 'quiz-prep' | 'exam-crunch'

export type UnlockSource = 'classroom_log' | 'pacing_calendar'

export interface MasteryRecord {
  topic_id: string
  pack_id: string
  mastery_score: number // 0.0–1.0
  attempts: number
  correct: number
  frq_attempts: number
  frq_score_total: number
  last_seen: Date | null
  updated_at: Date
}

export interface TopicWithState extends Topic {
  unlock_state: 'locked' | 'unlocked' | 'prioritized'
  mastery_score: number
  last_seen: Date | null
  days_since_seen: number
  priority_score: number // computed by selector
}

export interface SessionPlan {
  mode: SessionMode
  topics: TopicWithState[] // ordered by priority
  target_question_count: number
  target_duration_minutes: number
  notes: string[] // human-readable explanation of selections
}

export interface QuestionResult {
  topic_id: string
  question_type: 'mc' | 'frq' | 'conceptual'
  correct: boolean
  frq_score?: number // 0–4, frq only
  time_spent_seconds: number
  // Optional: when present, recordQuestionResult uses it to skip a
  // duplicate write if this question was already recorded for this
  // session (see session-orchestrator.js). Omitted by scripts/test-engine.js's
  // synthetic results, which have no real question_bank row to reference.
  question_id?: string
}

// Mirrors the `quiz_prep_events` table (migrations/001_initial_schema.sql,
// widened by migrations/006_quiz_prep_skip_result.sql). 'skipped' covers
// both a 3rd post-quiz-prompt skip and an auto-dismiss when the prompt
// would surface more than 14 days after the quiz — see
// session-orchestrator.js's startSession and api/quiz-prep/index.js.
export interface QuizPrepEvent {
  id: string
  user_id: string
  pack_id: string
  topic_ids: string[]
  quiz_date: string // ISO date
  created_at: string
  expired_at: string | null
  post_quiz_result: 'good' | 'okay' | 'rough' | 'skipped' | null
}

// Returned by startSession instead of a SessionPlan when an expired quiz
// prep event still needs a post-quiz result — the client shows
// PostQuizPrompt instead of starting a session (see Session.tsx).
export interface RequiresPostQuiz {
  requires_post_quiz: true
  event_id: string
  topic_names: string[]
  days_since_quiz: number
}
