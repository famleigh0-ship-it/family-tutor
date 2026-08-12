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
