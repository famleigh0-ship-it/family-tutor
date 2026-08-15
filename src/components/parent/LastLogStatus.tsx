interface Props {
  lastLogAt: string | null
  method?: 'photo' | 'text' | 'checklist' | null
  compact?: boolean
}

const WARN_AFTER_DAYS = 3
const METHOD_LABEL: Record<string, string> = { photo: 'photo', text: 'description', checklist: 'checklist' }

function isWeekday(date: Date) {
  const day = date.getDay() // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default function LastLogStatus({ lastLogAt, method, compact = false }: Props) {
  const days = lastLogAt ? daysSince(lastLogAt) : Infinity
  // No warning on weekends per spec — a Friday-to-Monday gap during normal
  // weekend downtime shouldn't read as a problem.
  const warn = days >= WARN_AFTER_DAYS && isWeekday(new Date())

  const label = !lastLogAt ? 'No log yet' : days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`

  return (
    <p className={`flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'} ${warn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
      Last log: {label}
      {method && !warn && lastLogAt ? ` (${METHOD_LABEL[method] ?? method})` : ''}
      {!warn && lastLogAt && days <= 0 ? ' ✓' : ''}
      {warn ? ' ⚠' : ''}
    </p>
  )
}
