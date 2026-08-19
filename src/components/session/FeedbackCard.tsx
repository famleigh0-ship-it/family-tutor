import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import type { GradeResult, ServedQuestion, SubmittedAnswer } from './types'

interface Props {
  question: ServedQuestion
  result: GradeResult
  // Only set for typed/photo answers (FRQ, conceptual) — never for MC,
  // whose selected option is already shown color-coded on the question
  // card itself before the transition here, so re-showing it would be
  // redundant. See YourAnswerDisclosure below.
  submittedAnswer?: SubmittedAnswer
  isLast: boolean
  onNext: () => void
  // Phase 10 exam-crunch: show the explicit AP-exam point value alongside
  // the score for FRQs, per spec.
  crunchMode?: boolean
}

// Collapsed by default so it doesn't compete with the feedback itself —
// students who want to double-check exactly what they wrote can expand it,
// everyone else never sees it.
function YourAnswerDisclosure({ submittedAnswer }: { submittedAnswer: SubmittedAnswer }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-[44px] w-full items-center justify-between text-sm font-medium text-slate-500 dark:text-slate-400"
      >
        Your answer
        <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {expanded && (
        <div className="mt-1 max-h-40 overflow-y-auto [animation:fadeIn_150ms_ease-in]">
          {submittedAnswer.imageDataUrl ? (
            <img
              src={submittedAnswer.imageDataUrl}
              alt="What you submitted"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800"
            />
          ) : (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {submittedAnswer.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type Tone = 'correct' | 'partial' | 'wrong'

function hasElements(result: GradeResult): result is GradeResult & { correct_elements: string[]; missing_elements: string[] } {
  return 'correct_elements' in result
}

function hasFrqScore(result: GradeResult): result is GradeResult & { frq_score: number | null } {
  return 'frq_score' in result
}

function hasFollowUp(result: GradeResult): result is GradeResult & { follow_up?: string } {
  return 'follow_up' in result
}

function hasPartiallyReadable(result: GradeResult): result is GradeResult & { partially_readable: boolean; illegible_sections?: string } {
  return 'partially_readable' in result
}

function getTone(question: ServedQuestion, result: GradeResult): Tone {
  if (question.question_type === 'mc') {
    return 'correct' in result && result.correct ? 'correct' : 'wrong'
  }
  const scoreNormalized = 'score_normalized' in result ? result.score_normalized : result.correct ? 1 : 0
  if (scoreNormalized >= 0.9) return 'correct'
  if (scoreNormalized > 0) return 'partial'
  return 'wrong'
}

const TONE_STYLES: Record<Tone, { bar: string; label: string }> = {
  correct: { bar: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300', label: '✓ Correct!' },
  partial: { bar: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300', label: '◐ Partial credit' },
  wrong: { bar: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300', label: '✗ Not quite' }
}

type ReportState = 'idle' | 'reporting' | 'reported' | 'error'

export default function FeedbackCard({ question, result, submittedAnswer, isLast, onNext, crunchMode }: Props) {
  const tone = getTone(question, result)
  const style = TONE_STYLES[tone]
  const [reportState, setReportState] = useState<ReportState>('idle')

  // Added after a real grading error slipped through during Phase 11
  // launch testing (a question's correct_answer was flagged wrong) — a
  // low-friction way to flag a question for review without derailing the
  // session. No note field on purpose: keeping this to one tap means she'll
  // actually use it mid-session instead of skipping past something that
  // seemed off.
  async function handleReport() {
    setReportState('reporting')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch('/api/bank', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question_id: question.id,
          pack_id: question.pack_id,
          topic_id: question.topic_id,
          question_type: question.question_type
        })
      })
      if (!res.ok) throw new Error('Failed to report question')
      setReportState('reported')
    } catch {
      setReportState('error')
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 [animation:slideUp_200ms_ease-out] dark:border-slate-800">
      <div className={`px-4 py-3 text-base font-semibold ${style.bar}`}>{style.label}</div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
        {hasFrqScore(result) && result.frq_score !== null && question.question_type === 'frq' && crunchMode && (
          <p className="text-sm font-medium text-red-700 dark:text-red-300">
            This question is worth up to 4 points on the AP exam. You scored {result.frq_score}/4.
          </p>
        )}

        {hasFrqScore(result) && result.frq_score !== null && !(crunchMode && question.question_type === 'frq') && (
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Score: {result.frq_score}/4</p>
        )}

        {hasPartiallyReadable(result) && result.partially_readable && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Note: part of your work was hard to read{result.illegible_sections ? ` — ${result.illegible_sections}` : ''}. The grade
            reflects what was visible.
          </div>
        )}

        <p className="text-base leading-relaxed text-slate-900 dark:text-slate-50">{result.feedback}</p>

        {hasElements(result) && result.correct_elements.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">What you got right</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
              {result.correct_elements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {hasElements(result) && result.missing_elements.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">What to work on</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
              {result.missing_elements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {hasFollowUp(result) && result.follow_up && (
          <p className="text-sm italic text-slate-500 dark:text-slate-400">{result.follow_up}</p>
        )}
      </div>

      <div className="border-t border-slate-200 p-4 dark:border-slate-800">
        {/* Lives in the fixed footer, not the scrollable feedback body above —
            long AI-generated feedback (multi-paragraph critique plus bullet
            lists) can push this well below the fold inside that small
            max-h-[60vh] box on mobile, making it hard to relocate once
            collapsed. The footer is never clipped/scrolled, so this stays
            reachable regardless of how long the feedback text is. */}
        {submittedAnswer && <YourAnswerDisclosure submittedAnswer={submittedAnswer} />}

        <button
          type="button"
          onClick={onNext}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          {isLast ? 'Finish' : 'Next Question'}
        </button>

        <div className="mt-1 text-center">
          {(reportState === 'idle' || reportState === 'reporting') && (
            <button
              type="button"
              onClick={handleReport}
              disabled={reportState === 'reporting'}
              className="flex min-h-[44px] w-full items-center justify-center text-xs text-slate-400 underline disabled:opacity-50 dark:text-slate-500"
            >
              {reportState === 'reporting' ? 'Reporting...' : 'Report this question'}
            </button>
          )}
          {reportState === 'reported' && (
            <p className="flex min-h-[44px] items-center justify-center text-xs text-emerald-600 dark:text-emerald-400">
              Reported — thanks, we'll take a look ✓
            </p>
          )}
          {reportState === 'error' && (
            <button
              type="button"
              onClick={handleReport}
              className="flex min-h-[44px] w-full items-center justify-center text-xs text-red-500 underline dark:text-red-400"
            >
              Couldn't report — tap to try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
