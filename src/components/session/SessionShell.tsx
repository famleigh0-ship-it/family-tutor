import { useState } from 'react'

interface Props {
  packName: string
  elapsedSeconds: number
  currentQuestionNumber: number
  totalQuestions: number
  completedQuestions: number
  topicName: string
  onLeave: () => void
  children: React.ReactNode
  banner?: string | null
  // Phase 10 exam-crunch mode: red header instead of the default
  // white/slate, red banner instead of indigo, and no amber/red timer
  // escalation (the mode itself is already visually urgent — the spec is
  // explicit about not doubling that up).
  urgent?: boolean
}

const AMBER_THRESHOLD_SECONDS = 25 * 60
const RED_THRESHOLD_SECONDS = 35 * 60

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function SessionShell({
  packName,
  elapsedSeconds,
  currentQuestionNumber,
  totalQuestions,
  completedQuestions,
  topicName,
  onLeave,
  children,
  banner,
  urgent
}: Props) {
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  const timerColor = urgent
    ? 'text-white'
    : elapsedSeconds >= RED_THRESHOLD_SECONDS
      ? 'text-red-600 dark:text-red-400'
      : elapsedSeconds >= AMBER_THRESHOLD_SECONDS
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-slate-500 dark:text-slate-400'

  const progressPercent = totalQuestions > 0 ? Math.min(100, Math.round((completedQuestions / totalQuestions) * 100)) : 0

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header
        className={`sticky top-0 z-10 border-b px-4 py-3 ${
          urgent
            ? 'border-red-800 bg-red-700 dark:border-red-950 dark:bg-red-900'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
        }`}
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setConfirmingLeave(true)}
            aria-label="Leave session"
            className={`-ml-2 flex h-11 w-11 items-center justify-center text-xl ${urgent ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}
          >
            ←
          </button>
          <p className={`flex-1 truncate px-2 text-center text-base font-semibold ${urgent ? 'text-white' : 'text-slate-900 dark:text-slate-50'}`}>
            {packName}
          </p>
          <p className={`w-14 text-right text-sm font-medium tabular-nums ${timerColor}`}>⏱ {formatTimer(elapsedSeconds)}</p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className={`h-2 flex-1 overflow-hidden rounded-full ${urgent ? 'bg-red-900/50' : 'bg-slate-200 dark:bg-slate-800'}`}>
            <div
              className={`h-full rounded-full transition-all ${urgent ? 'bg-white' : 'bg-slate-900 dark:bg-slate-100'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className={`whitespace-nowrap text-sm ${urgent ? 'text-red-100' : 'text-slate-500 dark:text-slate-400'}`}>
            {currentQuestionNumber} of {totalQuestions}
          </p>
        </div>

        <p className={`mt-1.5 truncate text-sm ${urgent ? 'text-red-100' : 'text-slate-500 dark:text-slate-400'}`}>Topic: {topicName}</p>
      </header>

      {banner &&
        (urgent ? (
          <div className="border-b border-red-900 bg-red-800 px-4 py-2 text-center text-sm font-medium text-white dark:border-red-950 dark:bg-red-950">
            {banner}
          </div>
        ) : (
          <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-center text-sm font-medium text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
            {banner}
          </div>
        ))}

      <main className="mx-auto max-w-sm px-4 py-6">{children}</main>

      {confirmingLeave && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 dark:bg-slate-900">
            <p className="text-base font-medium text-slate-900 dark:text-slate-50">Leave session?</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Progress will be saved.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingLeave(false)}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base font-medium text-slate-900 dark:border-slate-700 dark:text-slate-100"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={onLeave}
                className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
