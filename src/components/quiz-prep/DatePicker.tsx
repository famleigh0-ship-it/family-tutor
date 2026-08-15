import { useState } from 'react'

interface Props {
  initialDate?: string
  onNext: (quizDate: string) => void
}

const MIN_DAYS_OUT = 1 // tomorrow — no same-day quiz prep
const MAX_DAYS_OUT = 30
const MS_PER_DAY = 86_400_000

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatLabel(dateStr: string) {
  // Parsed as UTC midnight so the label doesn't shift a day depending on
  // the browser's local timezone offset.
  const date = new Date(`${dateStr}T00:00:00.000Z`)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export default function DatePicker({ initialDate, onNext }: Props) {
  const min = toDateOnly(new Date(Date.now() + MIN_DAYS_OUT * MS_PER_DAY))
  const max = toDateOnly(new Date(Date.now() + MAX_DAYS_OUT * MS_PER_DAY))
  const [quizDate, setQuizDate] = useState(initialDate && initialDate >= min && initialDate <= max ? initialDate : '')

  return (
    <div className="space-y-6">
      <p className="text-base font-medium text-slate-900">When is the quiz?</p>

      <input
        type="date"
        min={min}
        max={max}
        value={quizDate}
        onChange={(e) => setQuizDate(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base text-slate-900"
      />

      {quizDate && (
        <div className="rounded-lg bg-slate-100 px-4 py-3 text-center">
          <p className="text-sm font-medium text-slate-900">{formatLabel(quizDate)}</p>
        </div>
      )}

      <button
        type="button"
        disabled={!quizDate}
        onClick={() => onNext(quizDate)}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50"
      >
        Set Quiz Prep →
      </button>
    </div>
  )
}
