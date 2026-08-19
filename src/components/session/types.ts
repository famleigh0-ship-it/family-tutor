export interface SessionTopic {
  id: string
  name: string
  input_mode: 'typed' | 'photo'
  type: 'conceptual' | 'quantitative' | 'mixed'
  difficulty: 1 | 2 | 3
  mastery_score: number
  mastery_label: string
}

export interface SessionPlanResponse {
  session_id: string
  pack_name: string
  mode: string
  topics: SessionTopic[]
  target_question_count: number
  target_duration_minutes: number
  notes: string[]
  // Which question types this pack allows (e.g. NMSQT's MC-only
  // restriction) — Session.tsx builds its question-type cycle from this.
  allowed_question_types: QuestionType[]
}

export type QuestionType = 'mc' | 'frq' | 'conceptual'

export interface MCOption {
  label: string
  text: string
}

export interface FRQPart {
  part: string
  prompt: string
  points: number
}

export interface ServedQuestion {
  id: string
  pack_id: string
  topic_id: string
  question_type: QuestionType
  input_mode: 'typed' | 'photo'
  difficulty: 1 | 2 | 3
  question_text: string
  options?: MCOption[]
  parts?: FRQPart[] | null
}

export interface MCGradeResult {
  correct: boolean
  feedback: string
  correct_answer: string
  explanation?: string
}

export interface TypedGradeResult {
  correct: boolean
  frq_score: number | null
  score_normalized: number
  correct_elements: string[]
  missing_elements: string[]
  misconception_detected: string | null
  feedback: string
  follow_up?: string
}

export interface PhotoNotReadableResult {
  readable: false
  feedback: string
}

export interface PhotoGradeResult {
  readable: true
  partially_readable: boolean
  frq_score: number | null
  score_normalized: number
  correct_elements: string[]
  missing_elements: string[]
  illegible_sections?: string
  misconception_detected: string | null
  feedback: string
  follow_up?: string
}

export type GradeResult = MCGradeResult | TypedGradeResult | PhotoGradeResult

// What the student actually submitted, lifted from the question component's
// local state up to FeedbackCard so they can review it — text for a typed
// FRQ/conceptual answer, an image for a photo FRQ. Never set for MC (the
// selected option is already shown color-coded on the question card itself
// before the transition to feedback, so re-showing it here would be
// redundant).
export interface SubmittedAnswer {
  text?: string
  imageDataUrl?: string
}

export interface AnsweredResult {
  topic_id: string
  topic_name: string
  question_type: QuestionType
  correct: boolean
  frq_score: number | null
}

export interface SessionEndResponse {
  duration_seconds: number
  questions_attempted: number
  questions_correct: number
  current_streak: number
  topics: { id: string; name: string; mastery_score: number; mastery_label: string }[]
}

// Persisted to localStorage (survives a PWA's underlying page/WebView being
// torn down and recreated when backgrounded — sessionStorage does not) so
// an interrupted session can resume within the 2-hour window described in
// the Phase 7 spec.
export interface StoredSessionState {
  sessionId: string
  packName: string
  mode: string
  topics: SessionTopic[]
  targetQuestionCount: number
  targetDurationMinutes: number
  allowedQuestionTypes: QuestionType[]
  questionIndex: number
  answeredResults: AnsweredResult[]
  startedAtIso: string
  // The exact question currently being shown (unanswered), plus when it was
  // served — lets a resume within QUESTION_MEMORY_MS restore this literal
  // question instead of fetching a new random one for the same topic/type.
  // Undefined once the question has been answered or the session has moved
  // on (see Session.tsx's persistProgress).
  currentQuestion?: ServedQuestion
  questionServedAtIso?: string
}
