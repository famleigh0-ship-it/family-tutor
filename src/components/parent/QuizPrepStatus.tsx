import type { QuizPrepEventSummary, QuizPrepResultSummary } from '../progress/types'

interface Props {
  active: QuizPrepEventSummary | null
  history?: QuizPrepResultSummary[]
}

const RESULT_EMOJI: Record<string, string> = { good: '😊', okay: '😐', rough: '😟', skipped: '⏭' }

function quizTimingLabel(daysUntilQuiz: number) {
  if (daysUntilQuiz <= 0) return 'Quiz today!'
  if (daysUntilQuiz === 1) return 'Quiz tomorrow!'
  return `Quiz in ${daysUntilQuiz} days`
}

export default function QuizPrepStatus({ active, history = [] }: Props) {
  if (!active && history.length === 0) return null

  return (
    <div className="space-y-1.5 text-sm">
      {active && (
        <div className="rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/40">
          <p className="font-medium text-indigo-800 dark:text-indigo-300">🎯 {active.topic_names.join(', ')}</p>
          <p className="text-indigo-700 dark:text-indigo-400">📅 {quizTimingLabel(active.days_until_quiz)}</p>
        </div>
      )}
      {history.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {history.map((r) => `${RESULT_EMOJI[r.post_quiz_result] ?? '·'} ${r.quiz_date}`).join('  ')}
        </p>
      )}
    </div>
  )
}
