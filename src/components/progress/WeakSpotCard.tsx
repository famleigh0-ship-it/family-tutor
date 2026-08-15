import { useNavigate } from 'react-router-dom'
import type { WeakSpot } from './types'

interface Props {
  packId: string
  weakSpots: WeakSpot[]
  readOnly?: boolean
}

function formatLastPracticed(daysSinceSeen: number | null) {
  if (daysSinceSeen === null) return 'Never'
  if (daysSinceSeen <= 0) return 'Today'
  if (daysSinceSeen === 1) return 'Yesterday'
  return `${daysSinceSeen} days ago`
}

export default function WeakSpotCard({ packId, weakSpots, readOnly = false }: Props) {
  const navigate = useNavigate()

  if (weakSpots.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
        No focus areas to show right now. Keep practicing to build up mastery data, or great work if you've already
        mastered everything here!
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">⚠ Focus Areas</p>

      <ol className="mt-3 space-y-3">
        {weakSpots.map((spot, i) => (
          <li key={spot.topic_id} className="text-sm">
            <p className="font-medium text-slate-900 dark:text-slate-50">
              {i + 1}. {spot.topic_name}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              {spot.unit_name} · {spot.mastery_label}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Last practiced: {formatLastPracticed(spot.days_since_seen)}
            </p>
          </li>
        ))}
      </ol>

      {!readOnly && (
        <button
          type="button"
          onClick={() =>
            navigate(`/session/${packId}`, { state: { forceTopicIds: weakSpots.map((s) => s.topic_id) } })
          }
          className="mt-4 min-h-[44px] w-full rounded-lg bg-amber-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-amber-200 dark:text-amber-950"
        >
          Practice weak spots
        </button>
      )}
    </div>
  )
}
