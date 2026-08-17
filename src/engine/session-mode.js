// Plain JS — see mastery.js header for why.

const NMSQT_CRUNCH_DAYS = 21 // 3 weeks — fixed for NMSQT, unlike AP's per-pack exam_crunch_weeks

/**
 * @param {{ sessionCount: number, daysUntilExam: number, examCrunchWeeks: number, activeQuizPrepEvent: import('./types').QuizPrepEvent | null, isNMSQT?: boolean }} params
 * @returns {import('./types').SessionMode}
 */
export function detectSessionMode(params) {
  // NMSQT has no onboarding and no quiz-prep concept at all (no
  // WelcomeFlow/quiz-prep UI is ever shown for it — see Home.jsx) — just a
  // fixed 3-week exam-crunch window, then adaptive otherwise. Checked
  // first and returns early so nothing below this branch ever runs for an
  // NMSQT pack.
  if (params.isNMSQT) {
    return params.daysUntilExam <= NMSQT_CRUNCH_DAYS ? 'exam-crunch' : 'adaptive'
  }

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
