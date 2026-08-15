import type { StreakDay } from './types'

interface Props {
  days: StreakDay[] // oldest -> newest, last entry is today
  currentStreak: number
  longestStreak: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayOfWeekUtc(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCDay() // 0 = Sunday
}

function monthOfUtc(dateStr: string) {
  return new Date(`${dateStr}T00:00:00.000Z`).getUTCMonth()
}

export default function StreakCalendar({ days, currentStreak, longestStreak }: Props) {
  if (days.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No session history yet.</p>
  }

  const todayStr = days[days.length - 1].date
  const leadingPad = dayOfWeekUtc(days[0].date)
  const cells: (StreakDay | null)[] = [...Array(leadingPad).fill(null), ...days]

  const weeks: (StreakDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  let lastMonth = -1
  const weekLabels = weeks.map((week) => {
    const firstReal = week.find((d) => d !== null)
    if (!firstReal) return ''
    const month = monthOfUtc(firstReal.date)
    if (month === lastMonth) return ''
    lastMonth = month
    return MONTH_LABELS[month]
  })

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col items-center gap-1">
            <span className="h-3 text-[9px] leading-3 text-slate-400 dark:text-slate-500">{weekLabels[wi]}</span>
            {week.map((day, di) => {
              if (!day) return <span key={di} className="h-3 w-3" />
              const isToday = day.date === todayStr
              const classes = day.active
                ? 'bg-emerald-400 dark:bg-emerald-500'
                : isToday
                  ? 'border border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-950'
                  : 'bg-gray-100 dark:bg-slate-800'
              return <span key={di} title={day.date} className={`h-3 w-3 rounded-sm ${classes}`} />
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-slate-600 dark:text-slate-300">
        <span>🔥 Current streak: {currentStreak} day{currentStreak === 1 ? '' : 's'}</span>
        <span>Best streak: {longestStreak} day{longestStreak === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
