interface Props {
  packName: string
  examDate: string // ISO date
  schoolYearStart: string // ISO date
}

const MS_PER_DAY = 86_400_000

function colorFor(daysAway: number) {
  if (daysAway < 60) return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' }
  if (daysAway <= 180) return { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
}

export default function ExamCountdown({ packName, examDate, schoolYearStart }: Props) {
  const now = Date.now()
  const exam = new Date(examDate).getTime()
  const start = new Date(schoolYearStart).getTime()

  const daysAway = Math.ceil((exam - now) / MS_PER_DAY)
  const totalDays = Math.max(1, Math.round((exam - start) / MS_PER_DAY))
  const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((now - start) / MS_PER_DAY)))
  const pct = Math.round((elapsedDays / totalDays) * 100)
  const { bar, text } = colorFor(daysAway)

  const examLabel = new Date(examDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">📅 {packName} Exam</p>
      <p className={`mt-1 text-lg font-semibold ${text}`}>{daysAway >= 0 ? `${daysAway} days away` : 'Exam has passed'}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{examLabel}</p>

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">School year: {pct}%</p>
      </div>
    </div>
  )
}
