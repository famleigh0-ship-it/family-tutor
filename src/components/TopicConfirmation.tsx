import { useState } from 'react'
import { getPack, getTopic } from '../packs/loader'

interface Props {
  packId: string
  extractedTopicIds: string[]
  confidence: 'high' | 'medium' | 'low'
  sourceLabel: string
  saving: boolean
  onSave: (confirmedTopicIds: string[]) => void
  onStartOver: () => void
}

export default function TopicConfirmation({
  packId,
  extractedTopicIds,
  confidence,
  sourceLabel,
  saving,
  onSave,
  onStartOver
}: Props) {
  const pack = getPack(packId)
  const [confirmed, setConfirmed] = useState<string[]>(extractedTopicIds)
  const [showAddPicker, setShowAddPicker] = useState(false)

  const allTopics = pack.units.flatMap((unit) =>
    unit.topics.filter((t) => !t.bc_only).map((t) => ({ ...t, unitName: unit.name }))
  )
  const confirmedSet = new Set(confirmed)
  const remaining = allTopics.filter((t) => !confirmedSet.has(t.id))

  function remove(topicId: string) {
    setConfirmed((prev) => prev.filter((id) => id !== topicId))
  }

  function add(topicId: string) {
    setConfirmed((prev) => [...prev, topicId])
    setShowAddPicker(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{sourceLabel}</p>

      {(confidence === 'low' || confidence === 'medium') && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          I wasn't fully confident about some matches — please review carefully.
        </div>
      )}

      <div className="space-y-2">
        {confirmed.length === 0 && <p className="text-sm text-slate-500">No topics selected yet.</p>}
        {confirmed.map((topicId) => {
          let topic
          try {
            topic = getTopic(packId, topicId)
          } catch {
            return null
          }
          const unit = pack.units.find((u) => u.topics.some((t) => t.id === topicId))
          return (
            <div key={topicId} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900">{topic.name}</p>
                <p className="text-xs text-slate-500">{unit?.name}</p>
              </div>
              <button
                type="button"
                onClick={() => remove(topicId)}
                aria-label={`Remove ${topic.name}`}
                className="px-2 text-slate-400"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      {!showAddPicker ? (
        <button type="button" onClick={() => setShowAddPicker(true)} className="text-sm text-slate-600 underline">
          + Add a topic
        </button>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
          {remaining.length === 0 && <p className="p-2 text-sm text-slate-400">No other topics to add.</p>}
          {remaining.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => add(t.id)}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
            >
              {t.name} <span className="text-xs text-slate-400">({t.unitName})</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2">
        <button
          type="button"
          onClick={() => onSave(confirmed)}
          disabled={saving || confirmed.length === 0}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onStartOver} className="w-full text-center text-sm text-slate-500 underline">
          Start over
        </button>
      </div>
    </div>
  )
}
