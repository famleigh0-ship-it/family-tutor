import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { getPack } from '../../packs/loader'

interface Props {
  packId: string
  userId: string
  initialSelected?: string[]
  onNext: (selectedTopicIds: string[]) => void
}

function difficultyDots(difficulty: 1 | 2 | 3) {
  return '●'.repeat(difficulty) + '○'.repeat(3 - difficulty)
}

// Unlike TopicChecklist.tsx (classroom logging), quiz prep does NOT filter
// out bc_only topics — a quiz can cover any unlocked topic, including a
// BC-only one that unlocked via prerequisite completion.
export default function TopicSelector({ packId, userId, initialSelected, onNext }: Props) {
  const pack = getPack(packId)
  const [unlockedIds, setUnlockedIds] = useState<Set<string> | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected ?? []))

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
    return <p className="text-slate-500">Loading topics...</p>
  }

  return (
    <div className="space-y-6">
      <p className="text-base font-medium text-slate-900">What topics will the quiz cover?</p>

      {pack.units.map((unit) => {
        const topics = unit.topics.filter((t) => unlockedIds.has(t.id))
        if (topics.length === 0) return null

        return (
          <div key={unit.id}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">{unit.name}</h3>
              <button
                type="button"
                onClick={() => toggleUnit(topics.map((t) => t.id))}
                className="text-xs text-slate-500 underline"
              >
                Select all in {unit.name}
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {topics.map((topic) => (
                <label
                  key={topic.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(topic.id)}
                    onChange={() => toggle(topic.id)}
                    className="h-5 w-5 shrink-0"
                  />
                  <span className="flex-1 text-sm text-slate-900">{topic.name}</span>
                  <span className="shrink-0 text-sm tracking-wide text-slate-400" aria-label={`difficulty ${topic.difficulty}`}>
                    {difficultyDots(topic.difficulty)}
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
        onClick={() => onNext(Array.from(selected))}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50"
      >
        Next →
      </button>
    </div>
  )
}
