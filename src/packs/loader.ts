import type { CoursePack, Unit, Topic } from './types'
import { validatePackShape, checkPackIntegrity } from './validatePack.js'
import apPhysics1Raw from '../../course-packs/ap-physics-1/pack.json' with { type: 'json' }
import calcAbBcRaw from '../../course-packs/calc-ab-bc/pack.json' with { type: 'json' }

function loadAndValidate(raw: unknown): CoursePack {
  const shaped = validatePackShape(raw) as CoursePack
  const errors = checkPackIntegrity(shaped)
  if (errors.length > 0) {
    throw new Error(
      `[pack:${shaped.id}] failed integrity checks:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    )
  }
  return shaped
}

const packsById: Record<string, CoursePack> = {}
for (const raw of [apPhysics1Raw, calcAbBcRaw]) {
  const pack = loadAndValidate(raw)
  packsById[pack.id] = pack
}

export function getPack(packId: string): CoursePack {
  const pack = packsById[packId]
  if (!pack) throw new Error(`Unknown course pack: ${packId}`)
  return pack
}

export function getAllPacks(): CoursePack[] {
  return Object.values(packsById)
}

export function getUnit(packId: string, unitId: string): Unit {
  const pack = getPack(packId)
  const unit = pack.units.find((u) => u.id === unitId)
  if (!unit) throw new Error(`Unknown unit "${unitId}" in pack "${packId}"`)
  return unit
}

export function getTopic(packId: string, topicId: string): Topic {
  const pack = getPack(packId)
  for (const unit of pack.units) {
    const topic = unit.topics.find((t) => t.id === topicId)
    if (topic) return topic
  }
  throw new Error(`Unknown topic "${topicId}" in pack "${packId}"`)
}

export function getTopicsForWeek(packId: string, weekNumber: number): Topic[] {
  const pack = getPack(packId)
  const week = pack.pacing_calendar.find((w) => w.week === weekNumber)
  if (!week) return []
  return week.topic_ids.map((id) => getTopic(packId, id))
}

function currentWeekNumber(schoolYearStart: string, referenceDate: string): number {
  const start = new Date(schoolYearStart)
  const reference = new Date(referenceDate)
  const diffDays = Math.floor((reference.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

// A unit is "calendar-complete" as of a given week once every pacing week
// that teaches one of its topics has passed. BC-only units never appear on
// the AB pacing calendar at all (enforced by checkPackIntegrity), so this
// returns null for them — they unlock via prerequisite units instead, in
// isUnitUnlocked below.
function unitCalendarCompleteWeek(pack: CoursePack, unitId: string): number | null {
  const topicIds = new Set(getUnit(pack.id, unitId).topics.map((t) => t.id))
  let maxWeek: number | null = null
  for (const week of pack.pacing_calendar) {
    if (week.topic_ids.some((id) => topicIds.has(id))) {
      maxWeek = maxWeek === null ? week.week : Math.max(maxWeek, week.week)
    }
  }
  return maxWeek
}

function isUnitUnlocked(
  pack: CoursePack,
  unitId: string,
  currentWeek: number,
  memo: Map<string, boolean>
): boolean {
  if (memo.has(unitId)) return memo.get(unitId) as boolean

  const unit = getUnit(pack.id, unitId)
  const completeWeek = unitCalendarCompleteWeek(pack, unitId)

  const unlocked =
    completeWeek !== null
      ? completeWeek <= currentWeek
      : unit.prerequisite_unit_ids.length > 0 &&
        unit.prerequisite_unit_ids.every((id) => isUnitUnlocked(pack, id, currentWeek, memo))

  memo.set(unitId, unlocked)
  return unlocked
}

// Topics the pacing calendar says should be unlocked by `referenceDate`.
// AB (calendar-scheduled) topics unlock week by week as their pacing entry
// arrives. BC-only topics have no calendar entries at all, so their whole
// unit unlocks at once, once every prerequisite unit is calendar-complete.
export function getUnlockedTopics(packId: string, referenceDate: string): Topic[] {
  const pack = getPack(packId)
  const currentWeek = currentWeekNumber(pack.school_year_start, referenceDate)
  const memo = new Map<string, boolean>()

  const unlocked: Topic[] = []

  for (const unit of pack.units) {
    if (isUnitUnlocked(pack, unit.id, currentWeek, memo)) {
      for (const topic of unit.topics) {
        if (topic.bc_only) unlocked.push(topic)
      }
    }
  }

  for (const week of pack.pacing_calendar) {
    if (week.week <= currentWeek) {
      for (const topicId of week.topic_ids) {
        unlocked.push(getTopic(packId, topicId))
      }
    }
  }

  const seen = new Set<string>()
  return unlocked.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
}
