// Plain JS — see mastery.js header for why.

/**
 * @param {{ sessionCount: number, daysUntilExam: number, examCrunchWeeks: number, activeQuizPrepEvent: import('./types').QuizPrepEvent | null }} params
 * @returns {import('./types').SessionMode}
 */
export function detectSessionMode(params) {
  // Phase 10: 2-session onboarding, not 3 — was `< 3`, which meant
  // sessions 0, 1, AND 2 all counted as onboarding (three sessions).
  // Session.tsx's "Onboarding session N of 2" note and the post-session-2
  // transition screen (WelcomeFlow/PostOnboardingTransition) both assume
  // exactly two.
  if (params.sessionCount < 2) return 'onboarding'
  if (params.activeQuizPrepEvent !== null) return 'quiz-prep'
  if (params.daysUntilExam <= params.examCrunchWeeks * 7) return 'exam-crunch'
  return 'adaptive'
}
