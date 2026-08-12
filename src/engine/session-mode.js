// Plain JS — see mastery.js header for why.

/**
 * @param {{ sessionCount: number, daysUntilExam: number, examCrunchWeeks: number, activeQuizPrepEvent: import('./types').QuizPrepEvent | null }} params
 * @returns {import('./types').SessionMode}
 */
export function detectSessionMode(params) {
  if (params.sessionCount < 3) return 'onboarding'
  if (params.activeQuizPrepEvent !== null) return 'quiz-prep'
  if (params.daysUntilExam <= params.examCrunchWeeks * 7) return 'exam-crunch'
  return 'adaptive'
}
