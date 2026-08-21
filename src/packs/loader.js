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
import nmsqt2026Raw from '../../course-packs/nmsqt-2026/pack.json' with { type: 'json' }
import apUsHistoryRaw from '../../course-packs/ap-us-history/pack.json' with { type: 'json' }
import apWorldHistoryRaw from '../../course-packs/ap-world-history/pack.json' with { type: 'json' }

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
for (const raw of [apPhysics1Raw, calcAbBcRaw, apHumanGeographyRaw, nmsqt2026Raw, apUsHistoryRaw, apWorldHistoryRaw]) {
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

/** @param {CoursePack} pack @returns {boolean} */
export function isNMSQT(pack) {
  return pack.exam_type === 'nmsqt'
}

/** @param {CoursePack} pack @returns {number} */
export function getSessionDuration(pack) {
  return pack.session_duration_minutes ?? 25
}

/** @param {CoursePack} pack @returns {string[]} */
export function getAllowedQuestionTypes(pack) {
  return pack.question_types_allowed ?? ['mc', 'frq', 'conceptual']
}

// Legacy default: no per-user unseen-count refill trigger overridden by a
// pack, matches src/engine/bank-manager.js's original hardcoded REFILL_BELOW.
const DEFAULT_BANK_REFILL_THRESHOLD = { mc: 8, conceptual: 5, frq: 3 }

/**
 * How many unseen-by-this-user questions of a given type trigger a refill
 * for this pack/topic. Defaults to the values every pack has always used;
 * only bank_refill_threshold_mc is currently pack-overridable (nmsqt-2026
 * raises it to 20 so a much bigger bank stays "fresh" per student).
 * @param {CoursePack} pack @param {'mc'|'conceptual'|'frq'} questionType @returns {number}
 */
export function getBankRefillThreshold(pack, questionType) {
  const key = `bank_refill_threshold_${questionType}`
  return typeof pack[key] === 'number' ? pack[key] : DEFAULT_BANK_REFILL_THRESHOLD[questionType]
}

/**
 * Target total question-bank size per topic for a given type — deliberately
 * has NO default. Absent means "no target at all," which scripts/manage-bank.js's
 * fill-all reads as "keep today's legacy behavior" (exactly one batch per
 * needs-fill trigger, unbounded growth over time) rather than silently
 * capping or topping up every existing pack's bank size the first time this
 * shipped. Only packs that explicitly set bank_size_<type> (currently just
 * nmsqt-2026's bank_size_mc: 75) get the "top up to a target" behavior.
 * @param {CoursePack} pack @param {'mc'|'conceptual'|'frq'} questionType @returns {number | undefined}
 */
export function getBankSizeTarget(pack, questionType) {
  const key = `bank_size_${questionType}`
  return typeof pack[key] === 'number' ? pack[key] : undefined
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
