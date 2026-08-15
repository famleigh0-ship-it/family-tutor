import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HeatmapUnit, MasteryTier } from './types'

interface Props {
  packId: string
  units: HeatmapUnit[]
  readOnly?: boolean
}

// Phase 9 spec's color scale — deliberately different boundaries from
// mastery.js's getMasteryLabel (0.4-0.59 is "Developing" there, "Practicing"
// here); see api/progress/index.js's heatmapTier for why. Classes carry
// both light and dark-mode pairs since the app's Tailwind darkMode is
// 'media' (OS-driven, no manual toggle).
const TIER_CLASSES: Record<MasteryTier, string> = {
  none: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
  developing: 'bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-300',
  practicing: 'bg-amber-200 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  solid: 'bg-blue-200 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  mastered: 'bg-green-200 text-green-800 dark:bg-green-950 dark:text-green-300'
}

const LOCKED_CLASSES = 'bg-slate-100 text-slate-400 opacity-70 dark:bg-slate-900 dark:text-slate-600'

function formatLastPracticed(lastSeen: string | null) {
  if (!lastSeen) return 'Never'
  const days = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

export default function MasteryHeatmap({ packId, units, readOnly = false }: Props) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null)

  function toggleUnit(unitId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  function practiceTopic(topicId: string) {
    navigate(`/session/${packId}`, { state: { forceTopicIds: [topicId] } })
  }

  return (
    <div className="space-y-4">
      {units.map((unit) => {
        const isCollapsed = collapsed.has(unit.id)
        return (
          <div key={unit.id} className="rounded-xl border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => toggleUnit(unit.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-50">
                <span className="text-slate-400 dark:text-slate-500">{isCollapsed ? '▶' : '▼'}</span>
                {unit.name}
              </span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {unit.ap_exam_weight_min}-{unit.ap_exam_weight_max}%
              </span>
            </button>

            {!isCollapsed && (
              <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                {unit.topics.map((topic) => {
                  const locked = !topic.unlocked
                  const cellClasses = locked ? LOCKED_CLASSES : TIER_CLASSES[topic.tier]
                  const isExpanded = expandedTopicId === topic.id

                  return (
                    <div key={topic.id} className={isExpanded ? 'col-span-3' : ''}>
                      <button
                        type="button"
                        onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)}
                        className={`flex min-h-[44px] w-full flex-col gap-1 rounded-lg px-2 py-2 text-left ${cellClasses}`}
                      >
                        <span className="flex items-center gap-1 text-xs font-medium leading-tight">
                          {locked && topic.bc_only ? '🔒 ' : ''}
                          {topic.name}
                          {topic.bc_only && (
                            <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                              BC
                            </span>
                          )}
                        </span>
                        <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                          <span
                            className="block h-full rounded-full bg-current"
                            style={{ width: `${Math.round(topic.mastery_score * 100)}%` }}
                          />
                        </span>
                        <span className="text-[10px] opacity-80">{locked ? 'Locked' : topic.label}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                            <span>{topic.attempts} attempt{topic.attempts === 1 ? '' : 's'}</span>
                            <span>Last practiced: {formatLastPracticed(topic.last_seen)}</span>
                          </div>
                          {!readOnly && !locked && (
                            <button
                              type="button"
                              onClick={() => practiceTopic(topic.id)}
                              className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                            >
                              Practice this topic
                            </button>
                          )}
                          {locked && (
                            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                              Not unlocked yet{topic.bc_only ? ' — finishes once its prerequisite units are complete.' : '.'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
