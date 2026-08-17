export interface CoursePack {
  id: string
  name: string
  school_year_start: string // ISO date: "2026-08-11"
  exam_date: string // ISO date: "2027-05-XX"
  exam_crunch_weeks: number // weeks before exam to enter crunch mode
  tutor_persona: string // system prompt prefix for Claude
  subject_context: string // what makes this subject hard
  units: Unit[]
  pacing_calendar: PacingWeek[]
  common_misconceptions: Misconception[]
  frq_rubric: FRQRubric
  // NMSQT pack support (all optional, default to today's AP behavior when
  // absent — see src/packs/loader.js's isNMSQT/getSessionDuration/
  // getAllowedQuestionTypes helpers for the actual defaulting logic).
  exam_type?: 'ap' | 'nmsqt'
  session_duration_minutes?: number
  question_types_allowed?: ('mc' | 'frq' | 'conceptual')[]
  difficulty_escalation?: boolean
  // Bank sizing overrides (all optional, per question type). Absent means
  // "use the existing default behavior" — see src/packs/loader.js's
  // getBankSizeTarget/getBankRefillThreshold for exactly what that means
  // for each one; they are NOT symmetric (no bank_size_* means no target
  // cap at all — legacy unbounded single-batch-per-trigger fill-all
  // behavior — while no bank_refill_threshold_* falls back to a real
  // default number).
  bank_size_mc?: number
  bank_size_conceptual?: number
  bank_size_frq?: number
  bank_refill_threshold_mc?: number
}

export interface Unit {
  id: string
  name: string
  ap_exam_weight_min: number // % minimum
  ap_exam_weight_max: number // % maximum
  prerequisite_unit_ids: string[]
  topics: Topic[]
}

export interface Topic {
  id: string // format: "unit-id.topic-slug"
  name: string
  type: 'conceptual' | 'quantitative' | 'mixed'
  difficulty: 1 | 2 | 3
  prerequisite_topic_ids: string[]
  input_mode: 'typed' | 'photo' // default FRQ input mode for this topic
  bc_only?: boolean // Calc pack only
  prompt_hints: string[] // included in generation prompts
  common_errors: string[] // watched for in grading prompts
}

export interface PacingWeek {
  week: number // 1–36
  topic_ids: string[] // topics expected to be taught this week
}

export interface Misconception {
  id: string
  description: string
  affected_topic_ids: string[]
  detection_hints: string[]
}

export interface FRQRubric {
  general_guidance: string
  point_allocation_pattern: string
  common_reasoning_gaps: string[]
}
