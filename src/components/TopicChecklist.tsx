import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getPack } from '../packs/loader'

interface Props {
  packId: string
  userId: string
  onSave: (selectedTopicIds: string[]) => void
}

export default function TopicChecklist({ packId, userId, onSave }: Props) {
  const pack = getPack(packId)
  const [unlockedIds, setUnlockedIds] = useState<Set<string> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    supabase
      .from('topic_unlock_log')
      .select('topic_id')
      .eq('user_id', userId)
      .eq('pack_id', packId)
      .then(({ data }) => {
        if (!cancelled) setUnlockedIds(new Set((data ?? []).map((r) => r.topic_id as string)))
      })
    return () => {
      cancelled = true
    }
  }, [userId, packId])

  function toggle(topicId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(topicId)) next.delete(topicId)
      else next.add(topicId)
      return next
    })
  }

  function toggleUnit(topicIds: string[]) {
    setSelected((prev) => {
      const allSelected = topicIds.every((id) => prev.has(id))
      const next = new Set(prev)
      for (const id of topicIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  if (unlockedIds === null) {
    return <p className="text-slate-500 dark:text-slate-400">Loading topics...</p>
  }

  return (
    <div className="space-y-6">
      {pack.units.map((unit) => {
        // Classroom log is for what was covered in school — BC-only topics
        // are self-study and were never taught in class.
        const topics = unit.topics.filter((t) => !t.bc_only)
        if (topics.length === 0) return null

        return (
          <div key={unit.id}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{unit.name}</h3>
              <button
                type="button"
                onClick={() => toggleUnit(topics.map((t) => t.id))}
                className="flex min-h-[44px] items-center text-xs text-slate-500 underline dark:text-slate-400"
              >
                Select all
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {topics.map((topic) => (
                <label
                  key={topic.id}
                  className="flex min-h-[44px] items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(topic.id)}
                    onChange={() => toggle(topic.id)}
                    className="h-5 w-5 shrink-0"
                  />
                  <span className="flex-1 text-sm text-slate-900 dark:text-slate-50">{topic.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      unlockedIds.has(topic.id)
                        ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {unlockedIds.has(topic.id) ? 'Review' : 'New'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      <button
        type="button"
        disabled={selected.size === 0}
        onClick={() => onSave(Array.from(selected))}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        Save{selected.size > 0 ? ` (${selected.size})` : ''}
      </button>
    </div>
  )
}
