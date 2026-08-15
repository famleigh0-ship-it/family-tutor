import type { GradeResult, ServedQuestion } from './types'

interface Props {
  question: ServedQuestion
  result: GradeResult
  isLast: boolean
  onNext: () => void
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

export default function FeedbackCard({ question, result, isLast, onNext }: Props) {
  const tone = getTone(question, result)
  const style = TONE_STYLES[tone]

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div className={`px-4 py-3 text-base font-semibold ${style.bar}`}>{style.label}</div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
        {hasFrqScore(result) && result.frq_score !== null && (
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
        <button
          type="button"
          onClick={onNext}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          {isLast ? 'Finish' : 'Next Question'}
        </button>
      </div>
    </div>
  )
}
