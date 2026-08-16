// Plain JS (not .ts) so this loads identically under Vite, plain Node
// script execution, AND Vercel's serverless function bundler — which
// cannot resolve a directly-imported .ts file at runtime (confirmed via
// ERR_MODULE_NOT_FOUND when api/classroom/* imported the old loader.ts).
// See src/packs/validatePack.js for the same reasoning, one runtime prior.

/** @typedef {import('./types').CoursePack} CoursePack */
/** @typedef {import('./types').Unit} Unit */
/** @typedef {import('./types').Topic} Topic */

import { validatePackShape, checkPackIntegrity } from './validatePack.js'
import apPhysics1Raw from '../../course-packs/ap-physics-1/pack.json' with { type: 'json' }
import calcAbBcRaw from '../../course-packs/calc-ab-bc/pack.json' with { type: 'json' }
import apHumanGeographyRaw from '../../course-packs/ap-human-geography/pack.json' with { type: 'json' }

/**
 * @param {unknown} raw
 * @returns {CoursePack}
 */
function loadAndValidate(raw) {
  const shaped = validatePackShape(raw)
  const errors = checkPackIntegrity(shaped)
  if (errors.length > 0) {
    throw new Error(
      `[pack:${shaped.id}] failed integrity checks:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    )
  }
  return shaped
}

/** @type {Record<string, CoursePack>} */
const packsById = {}
for (const raw of [apPhysics1Raw, calcAbBcRaw, apHumanGeographyRaw]) {
  const pack = loadAndValidate(raw)
  packsById[pack.id] = pack
}

/** @returns {CoursePack} */
export function getPack(packId) {
  const pack = packsById[packId]
  if (!pack) throw new Error(`Unknown course pack: ${packId}`)
  return pack
}

/** @returns {CoursePack[]} */
export function getAllPacks() {
  return Object.values(packsById)
}

/** @returns {Unit} */
export function getUnit(packId, unitId) {
  const pack = getPack(packId)
  const unit = pack.units.find((u) => u.id === unitId)
  if (!unit) throw new Error(`Unknown unit "${unitId}" in pack "${packId}"`)
  return unit
}

/** @returns {Topic} */
export function getTopic(packId, topicId) {
  const pack = getPack(packId)
  for (const unit of pack.units) {
    const topic = unit.topics.find((t) => t.id === topicId)
    if (topic) return topic
  }
  throw new Error(`Unknown topic "${topicId}" in pack "${packId}"`)
}

/** @returns {Topic[]} */
export function getTopicsForWeek(packId, weekNumber) {
  const pack = getPack(packId)
  const week = pack.pacing_calendar.find((w) => w.week === weekNumber)
  if (!week) return []
  return week.topic_ids.map((id) => getTopic(packId, id))
}

function currentWeekNumber(schoolYearStart, referenceDate) {
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
function unitCalendarCompleteWeek(pack, unitId) {
  const topicIds = new Set(getUnit(pack.id, unitId).topics.map((t) => t.id))
  let maxWeek = null
  for (const week of pack.pacing_calendar) {
    if (week.topic_ids.some((id) => topicIds.has(id))) {
      maxWeek = maxWeek === null ? week.week : Math.max(maxWeek, week.week)
    }
  }
  return maxWeek
}

function isUnitUnlocked(pack, unitId, currentWeek, memo) {
  if (memo.has(unitId)) return memo.get(unitId)

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
/** @returns {Topic[]} */
export function getUnlockedTopics(packId, referenceDate) {
  const pack = getPack(packId)
  const currentWeek = currentWeekNumber(pack.school_year_start, referenceDate)
  const memo = new Map()

  const unlocked = []

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

  const seen = new Set()
  return unlocked.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
}
