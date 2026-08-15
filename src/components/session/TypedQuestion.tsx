import { useState } from 'react'
import HintButton from './HintButton'
import type { ServedQuestion, TypedGradeResult } from './types'

interface Props {
  question: ServedQuestion
  onSubmit: (payload: { student_answer: string }) => Promise<TypedGradeResult>
  onGraded: (result: TypedGradeResult) => void
}

const MAX_LENGTH = 1000
const MIN_LENGTH = 10
const MIN_ROWS = 4
const MAX_ROWS = 8

export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Grading your answer">
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s] dark:bg-slate-500" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s] dark:bg-slate-500" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500" />
    </span>
  )
}

export default function TypedQuestion({ question, onSubmit, onGraded }: Props) {
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [hintText, setHintText] = useState<string | null>(null)

  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, answer.split('\n').length))
  const canSubmit = answer.trim().length >= MIN_LENGTH

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await onSubmit({ student_answer: answer })
      onGraded(result)
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {hintText && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">💡 Hint</p>
          <p className="mt-1">{hintText}</p>
        </div>
      )}

      <p className="text-base leading-relaxed text-slate-900 dark:text-slate-50">{question.question_text}</p>

      {question.parts && question.parts.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {question.parts.map((part) => (
            <li key={part.part}>
              <span className="font-medium">({part.part})</span> {part.prompt}{' '}
              <span className="text-slate-400 dark:text-slate-500">[{part.points} pt{part.points === 1 ? '' : 's'}]</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <textarea
          value={answer}
          readOnly={submitting}
          onChange={(e) => setAnswer(e.target.value.slice(0, MAX_LENGTH))}
          rows={rows}
          placeholder="Your answer..."
          className="w-full rounded-lg border border-slate-300 p-3 text-base text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:border-slate-400 dark:focus:ring-slate-400"
        />
        <p className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">
          {answer.length}/{MAX_LENGTH}
        </p>
      </div>

      {submitting && (
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          Grading your answer... <ThinkingDots />
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <HintButton questionId={question.id} studentAnswerSoFar={answer} disabled={submitting} onHint={setHintText} />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {submitting ? 'Grading...' : 'Submit Answer'}
        </button>
      </div>
    </div>
  )
}
