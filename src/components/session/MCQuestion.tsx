import { useState } from 'react'
import HintButton from './HintButton'
import type { ServedQuestion, MCGradeResult } from './types'

interface Props {
  question: ServedQuestion
  onSubmit: (payload: { selected_option: string }) => Promise<MCGradeResult>
  onGraded: (result: MCGradeResult) => void
}

// After grading, briefly show the correct/wrong option colors on the card
// itself before handing off to FeedbackCard — matches the spec's literal
// sequencing ("correct option highlights green... transition to
// FeedbackCard") rather than jumping straight to the feedback screen.
const REVEAL_DELAY_MS = 700

export default function MCQuestion({ question, onSubmit, onGraded }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [revealed, setRevealed] = useState<MCGradeResult | null>(null)
  const [hintText, setHintText] = useState<string | null>(null)

  const options = question.options ?? []
  const locked = submitting || revealed !== null

  async function handleSubmit() {
    if (!selected) return
    setSubmitting(true)
    try {
      const result = await onSubmit({ selected_option: selected })
      setRevealed(result)
      setTimeout(() => onGraded(result), REVEAL_DELAY_MS)
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

      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = selected === option.label
          const isCorrectOption = revealed !== null && option.label === revealed.correct_answer
          const isWrongSelected = revealed !== null && isSelected && option.label !== revealed.correct_answer

          const toneClass = isCorrectOption
            ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40'
            : isWrongSelected
              ? 'border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
              : isSelected
                ? 'border-slate-900 bg-slate-100 dark:border-slate-100 dark:bg-slate-800'
                : 'border-slate-200 dark:border-slate-800'

          return (
            <button
              key={option.label}
              type="button"
              disabled={locked}
              onClick={() => setSelected(option.label)}
              className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left ${toneClass}`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border text-xs font-medium ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-400 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                }`}
              >
                {option.label}
              </span>
              <span className="text-base text-slate-900 dark:text-slate-50">{option.text}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <HintButton questionId={question.id} studentAnswerSoFar={selected ?? undefined} disabled={locked} onHint={setHintText} />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!selected || locked}
          className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white dark:border-slate-900/40 dark:border-t-slate-900" />
              Checking...
            </span>
          ) : (
            'Check Answer'
          )}
        </button>
      </div>
    </div>
  )
}
