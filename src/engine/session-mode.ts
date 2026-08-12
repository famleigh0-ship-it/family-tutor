import type { SessionMode, QuizPrepEvent } from './types'

export function detectSessionMode(params: {
  sessionCount: number // total sessions this student has done
  daysUntilExam: number
  examCrunchWeeks: number
  activeQuizPrepEvent: QuizPrepEvent | null
}): SessionMode {
  if (params.sessionCount < 3) return 'onboarding'
  if (params.activeQuizPrepEvent !== null) return 'quiz-prep'
  if (params.daysUntilExam <= params.examCrunchWeeks * 7) return 'exam-crunch'
  return 'adaptive'
}
