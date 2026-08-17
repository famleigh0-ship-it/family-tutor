// Plain JS — see mastery.js header for why.

/** @typedef {import('../packs/types').CoursePack} CoursePack */
/** @typedef {import('../packs/types').Unit} Unit */
/** @typedef {import('../packs/types').Topic} Topic */

import { getAllowedQuestionTypes } from '../packs/loader.js'
import { getCurrentDifficulty } from './mastery.js'

const MINUTES_PER_MC = 3
const MINUTES_PER_FRQ = 8
const CRITICAL_MASTERY_THRESHOLD = 0.4
const DECAY_BOOST_DAYS = 14
const EXAM_CRUNCH_WEIGHT_MULTIPLIER = 2.5 // Phase 10: was 2.0
// Phase 10 exam-crunch-only scoring boosts, layered on top of the
// all-mode boosts above (recencyPenalty/prioritizedBoost/criticalBoost/
// decayBoost) — same multiplicative-stacking style, just gated to
// mode === 'exam-crunch' so every other mode's scoring is untouched.
const CRUNCH_MASTERY_BOOST_THRESHOLD = 0.6
const CRUNCH_MASTERY_BOOST = 1.5
const CRUNCH_STALE_BOOST_DAYS = 7
const CRUNCH_STALE_BOOST = 1.4
const CRUNCH_BC_ONLY_BOOST = 2.0
const CRUNCH_MIN_DURATION_MINUTES = 25 // "nudge toward longer sessions during crunch"
const MIN_TOPICS = 2
const MAX_TOPICS = 4
const ONBOARDING_MAX_TOPICS = 3
const ONBOARDING_QUESTION_COUNT = 3 // Phase 10: always exactly 3 questions, regardless of topic count
const QUIZ_PREP_FILLER_FRACTION = 0.25 // "remaining 20-30% of session"
// Exported so session-orchestrator.js can reuse the same sizing formula
// after dropping a quiz-prep topic whose bank is entirely empty.
export const QUESTIONS_PER_TOPIC = 2 // rough estimate used to size target_question_count
const REVIEW_MASTERY_MIN = 0.6
const REVIEW_MASTERY_MAX = 0.8
const REVIEW_MIN_DAYS_SINCE_SEEN = 5
const MS_PER_DAY = 86_400_000
// NMSQT (difficulty_escalation) only: surface weak fundamentals first by
// boosting a topic still stuck at the entry difficulty within a
// high-exam-weight domain. "High-weight" is scoped to this pack's own
// range — nmsqt-2026's domains run 15-35% (R&W: 20/26/26/28, Math:
// 15/15/35/35), so 25 sits above the low-weight tier (15/20) and picks out
// the domains that matter most to the Selection Index.
const DIFFICULTY_ESCALATION_HIGH_WEIGHT_THRESHOLD = 25
const DIFFICULTY_ESCALATION_BOOST = 1.5

/**
 * @param {Date | null} date
 * @param {Date} now
 */
function daysSince(date, now) {
  if (!date) return Infinity
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY)
}

/**
 * @param {string} packId
 * @param {string} topicId
 * @returns {import('./types').MasteryRecord}
 */
function defaultMasteryRecord(packId, topicId) {
  return {
    topic_id: topicId,
    pack_id: packId,
    mastery_score: 0,
    attempts: 0,
    correct: 0,
    frq_attempts: 0,
    frq_score_total: 0,
    last_seen: null,
    updated_at: new Date(),
    difficulty_1_mastery: 0,
    difficulty_2_mastery: 0,
    difficulty_3_mastery: 0,
    current_difficulty: 1
  }
}

// Topics with photo input tend toward FRQ/diagram-heavy questions (slower);
// typed topics skew toward quicker MC/conceptual questions. This is a
// rough estimate for sizing a session — actual question generation
// determines real timing.
/** @param {import('./types').TopicWithState} topic */
function estimateMinutesPerQuestion(topic) {
  return topic.input_mode === 'photo' ? MINUTES_PER_FRQ : MINUTES_PER_MC
}

// No per-topic FRQ flag exists in the pack schema; conceptual-only
// topics are the ones least suited to a full FRQ treatment, so treat
// quantitative/mixed topics as the FRQ-capable set.
/** @param {Topic} topic */
function isFrqCapable(topic) {
  return topic.type === 'quantitative' || topic.type === 'mixed'
}

/**
 * @param {import('./types').TopicWithState[]} sorted
 * @param {number} targetMinutes
 * @param {number} minTopics
 * @param {number} maxTopics
 * @returns {import('./types').TopicWithState[]}
 */
function pickByDuration(sorted, targetMinutes, minTopics, maxTopics) {
  const picked = []
  let minutesUsed = 0

  for (const topic of sorted) {
    if (picked.length >= maxTopics) break
    picked.push(topic)
    minutesUsed += estimateMinutesPerQuestion(topic) * QUESTIONS_PER_TOPIC
    if (picked.length >= minTopics && minutesUsed >= targetMinutes) break
  }

  return picked
}

// Swaps the lowest-priority selected topic for `candidate` if `candidate`
// isn't already selected, or appends it when there's room under the cap.
/**
 * @param {import('./types').TopicWithState[]} selected
 * @param {import('./types').TopicWithState | undefined} candidate
 * @param {number} maxTopics
 * @returns {import('./types').TopicWithState[]}
 */
function ensureIncluded(selected, candidate, maxTopics) {
  if (!candidate || selected.some((t) => t.id === candidate.id)) return selected
  if (selected.length < maxTopics) return [...selected, candidate]
  return [...selected.slice(0, -1), candidate]
}

/**
 * @param {{
 *   pack: CoursePack,
 *   masteryRecords: import('./types').MasteryRecord[],
 *   unlockedTopicIds: string[],
 *   prioritizedTopicIds: string[],
 *   mode: import('./types').SessionMode,
 *   quizPrepTopicIds: string[],
 *   recentTopicIds: string[],
 *   targetDurationMinutes: number,
 *   quizPrepDaysUntilQuiz?: number,
 *   forceTopicIds?: string[]
 * }} params
 * @returns {import('./types').SessionPlan}
 */
export function selectTopics(params) {
  const {
    pack,
    masteryRecords,
    unlockedTopicIds,
    prioritizedTopicIds,
    mode,
    quizPrepTopicIds,
    recentTopicIds,
    targetDurationMinutes,
    quizPrepDaysUntilQuiz,
    forceTopicIds
  } = params

  const now = new Date()
  const notes = []

  const masteryByTopicId = new Map(masteryRecords.map((r) => [r.topic_id, r]))
  const unlockedSet = new Set(unlockedTopicIds)
  const prioritizedSet = new Set(prioritizedTopicIds)
  const recentSet = new Set(recentTopicIds)
  const quizPrepSet = new Set(quizPrepTopicIds)

  /** @type {Map<string, Unit>} */
  const unitByTopicId = new Map()
  for (const unit of pack.units) {
    for (const topic of unit.topics) {
      unitByTopicId.set(topic.id, unit)
    }
  }

  // STEP 1 — build the TopicWithState list. Locked topics (not in
  // unlockedTopicIds) are skipped entirely, per spec.
  /** @type {import('./types').TopicWithState[]} */
  const candidates = []
  for (const unit of pack.units) {
    for (const topic of unit.topics) {
      if (!unlockedSet.has(topic.id)) continue

      const record = masteryByTopicId.get(topic.id) ?? defaultMasteryRecord(pack.id, topic.id)

      // NMSQT (difficulty_escalation) only: difficulty here isn't the
      // pack's static per-topic value — it's the level to serve this
      // student next, recomputed per topic from their own per-difficulty
      // mastery. This flows unchanged through the rest of the pipeline
      // (SessionPlan -> api/session's leanTopic -> the client's bank-serve
      // request -> the served question's own difficulty column ->
      // recordQuestionResult), so nothing downstream needs to know it's
      // dynamic. AP packs keep the topic's fixed pack.json difficulty.
      const servedDifficulty = pack.difficulty_escalation ? getCurrentDifficulty(record) : topic.difficulty

      candidates.push({
        ...topic,
        difficulty: servedDifficulty,
        unlock_state: prioritizedSet.has(topic.id) ? 'prioritized' : 'unlocked',
        mastery_score: record.mastery_score,
        last_seen: record.last_seen,
        days_since_seen: daysSince(record.last_seen, now),
        priority_score: 0
      })
    }
  }

  const allowedQuestionTypes = getAllowedQuestionTypes(pack)

  if (candidates.length === 0) {
    return {
      mode,
      topics: [],
      target_question_count: 0,
      target_duration_minutes: 0,
      notes: ['No unlocked topics available'],
      allowed_question_types: allowedQuestionTypes
    }
  }

  // STEP 1b — forced topics (Progress view's "Practice this topic" /
  // "Practice weak spots" shortcuts) short-circuit the mode-specific
  // selection below entirely, the same way quiz-prep's forced topics do,
  // but for the whole plan rather than just a portion of it. Sorted by
  // mastery ascending — weakest first — same reasoning as quiz-prep's
  // forced sort. Falls through to normal mode-based selection if none of
  // the requested ids are actually unlocked (e.g. stale link, topic
  // re-locked) rather than returning an empty plan.
  if (forceTopicIds && forceTopicIds.length > 0) {
    const forceSet = new Set(forceTopicIds)
    const forced = candidates.filter((t) => forceSet.has(t.id)).sort((a, b) => a.mastery_score - b.mastery_score).slice(0, MAX_TOPICS)

    if (forced.length > 0) {
      return {
        mode,
        topics: forced,
        target_question_count: forced.length * QUESTIONS_PER_TOPIC,
        target_duration_minutes: targetDurationMinutes,
        notes: [`Focused practice: ${forced.map((t) => t.name).join(', ')}`],
        allowed_question_types: allowedQuestionTypes
      }
    }
  }

  // STEP 2 — score each candidate.
  const weightMultiplier = mode === 'exam-crunch' ? EXAM_CRUNCH_WEIGHT_MULTIPLIER : 1.0

  for (const t of candidates) {
    const unit = unitByTopicId.get(t.id)
    const weightMid = unit ? (unit.ap_exam_weight_min + unit.ap_exam_weight_max) / 2 : 1

    const base = (1 - t.mastery_score) * weightMid * weightMultiplier * t.difficulty
    const recencyPenalty = recentSet.has(t.id) ? 0.5 : 1.0
    const prioritizedBoost = t.unlock_state === 'prioritized' ? 2.0 : 1.0
    const criticalBoost = t.mastery_score < CRITICAL_MASTERY_THRESHOLD ? 1.5 : 1.0
    const decayBoost = t.days_since_seen > DECAY_BOOST_DAYS ? 1.3 : 1.0

    // Crunch-only boosts (see constants above) — no-op multiplication by
    // 1.0 outside exam-crunch mode.
    const crunchMasteryBoost =
      mode === 'exam-crunch' && t.mastery_score < CRUNCH_MASTERY_BOOST_THRESHOLD ? CRUNCH_MASTERY_BOOST : 1.0
    const crunchStaleBoost =
      mode === 'exam-crunch' && t.days_since_seen >= CRUNCH_STALE_BOOST_DAYS ? CRUNCH_STALE_BOOST : 1.0
    const crunchBcOnlyBoost = mode === 'exam-crunch' && t.bc_only ? CRUNCH_BC_ONLY_BOOST : 1.0

    // NMSQT (difficulty_escalation) only — surface weak fundamentals in
    // high-weight domains first. t.difficulty is the *served* difficulty
    // here (see the candidates loop above), so === 1 means this topic's
    // own difficulty_1_mastery hasn't cleared the escalation threshold yet.
    // Uses the topic's OWN ap_exam_weight_min/max (nmsqt-2026's pack.json
    // sets these per-domain: R&W 20/26/26/28, Math 15/15/35/35) rather than
    // weightMid above — weightMid is the unit's weight, and both NMSQT
    // units are an even 50/50 split, so it can't distinguish one domain
    // from another the way this boost needs to. Falls back to weightMid
    // for AP packs, which have no per-topic weight fields.
    const topicWeightMid =
      typeof t.ap_exam_weight_min === 'number' && typeof t.ap_exam_weight_max === 'number'
        ? (t.ap_exam_weight_min + t.ap_exam_weight_max) / 2
        : weightMid
    const difficultyEscalationBoost =
      pack.difficulty_escalation && t.difficulty === 1 && topicWeightMid >= DIFFICULTY_ESCALATION_HIGH_WEIGHT_THRESHOLD
        ? DIFFICULTY_ESCALATION_BOOST
        : 1.0

    t.priority_score =
      base *
      recencyPenalty *
      prioritizedBoost *
      criticalBoost *
      decayBoost *
      crunchMasteryBoost *
      crunchStaleBoost *
      crunchBcOnlyBoost *
      difficultyEscalationBoost
  }

  const sorted = [...candidates].sort((a, b) => b.priority_score - a.priority_score)

  // STEP 3 + 4 — mode-specific selection and question-count sizing.
  /** @type {import('./types').TopicWithState[]} */
  let selected
  // Set inside the exam-crunch branch below (duration nudge) and read by
  // the target_duration_minutes calc at the bottom.
  let crunchEffectiveTargetMinutes = targetDurationMinutes

  if (mode === 'onboarding') {
    // Phase 10: unit diversity, not just top-N by priority_score — walk
    // pack.units in order and take the first unlocked difficulty-1 topic
    // from each of the first 2 units that have one. ONBOARDING_MAX_TOPICS
    // stays as a hard cap in case a unit has none and a 3rd ends up needed.
    selected = []
    for (const unit of pack.units) {
      if (selected.length >= 2) break
      const topicInUnit = candidates.find((t) => t.difficulty === 1 && unitByTopicId.get(t.id)?.id === unit.id)
      if (topicInUnit) selected.push(topicInUnit)
    }
    if (selected.length === 0) {
      // No unit had an unlocked difficulty-1 topic at all — fall back to
      // the old top-N behavior rather than returning an empty plan.
      selected = sorted.filter((t) => t.difficulty === 1).slice(0, ONBOARDING_MAX_TOPICS)
    }
    notes.push('Onboarding mode — diagnostic questions only')
  } else if (mode === 'quiz-prep') {
    // Forced topics sort by mastery ascending (lowest first, not the
    // shared priority_score) — she needs the most practice on her weakest
    // quiz topics, per spec. Filler still comes from the priority-sorted
    // list.
    const forced = candidates
      .filter((t) => quizPrepSet.has(t.id))
      .sort((a, b) => a.mastery_score - b.mastery_score)
      .slice(0, MAX_TOPICS)
    const nonForced = sorted.filter((t) => !quizPrepSet.has(t.id))
    const fillerBudget = targetDurationMinutes * QUIZ_PREP_FILLER_FRACTION
    const filler = pickByDuration(nonForced, fillerBudget, 0, Math.max(0, MAX_TOPICS - forced.length))
    selected = [...forced, ...filler]

    if (forced.length > 0) {
      const topicNames = forced.map((t) => t.name).join(', ')
      if (quizPrepDaysUntilQuiz === 0) {
        notes.push(`Quiz today! Focused practice on ${topicNames}`)
      } else if (typeof quizPrepDaysUntilQuiz === 'number') {
        notes.push(`Quiz prep: ${topicNames} — ${quizPrepDaysUntilQuiz} day${quizPrepDaysUntilQuiz === 1 ? '' : 's'} until quiz`)
      } else {
        notes.push(`Quiz prep mode active for ${topicNames}`)
      }
    }
  } else if (mode === 'exam-crunch') {
    // "Never serve difficulty 1 questions in crunch" — difficulty is a
    // fixed attribute of a topic (not a per-question range), so this has
    // to mean excluding difficulty-1 topics from the candidate pool
    // itself. Falls back to the unfiltered pool if that leaves nothing
    // (e.g. right after unlock, before anything harder is available yet).
    const aboveDifficultyOne = sorted.filter((t) => t.difficulty > 1)
    const crunchPool = aboveDifficultyOne.length > 0 ? aboveDifficultyOne : sorted

    crunchEffectiveTargetMinutes = Math.max(targetDurationMinutes, CRUNCH_MIN_DURATION_MINUTES)
    selected = pickByDuration(crunchPool, crunchEffectiveTargetMinutes, MIN_TOPICS, MAX_TOPICS)

    if (!selected.some(isFrqCapable)) {
      const frqCandidate = crunchPool.find((t) => isFrqCapable(t) && !selected.some((s) => s.id === t.id))
      selected = ensureIncluded(selected, frqCandidate, MAX_TOPICS)
    }

    const examDate = new Date(pack.exam_date)
    const daysUntilExam = Math.ceil((examDate.getTime() - now.getTime()) / MS_PER_DAY)
    const priorityTopicNames = selected.slice(0, 3).map((t) => t.name).join(', ')
    notes.push(`EXAM CRUNCH: ${daysUntilExam} days until ${pack.name}`)
    notes.push(`Priority topics: ${priorityTopicNames}`)
    notes.push('FRQ required this session')
  } else {
    // adaptive (default)
    selected = pickByDuration(sorted, targetDurationMinutes, MIN_TOPICS, MAX_TOPICS)

    const hasCritical = selected.some((t) => t.mastery_score < CRITICAL_MASTERY_THRESHOLD)
    if (!hasCritical) {
      const criticalCandidate = sorted.find(
        (t) => t.mastery_score < CRITICAL_MASTERY_THRESHOLD && !selected.some((s) => s.id === t.id)
      )
      if (criticalCandidate) {
        selected = ensureIncluded(selected, criticalCandidate, MAX_TOPICS)
        notes.push(`Added ${criticalCandidate.name} — below critical mastery threshold`)
      }
    }

    const hasReview = selected.some(
      (t) =>
        t.mastery_score >= REVIEW_MASTERY_MIN &&
        t.mastery_score <= REVIEW_MASTERY_MAX &&
        t.days_since_seen >= REVIEW_MIN_DAYS_SINCE_SEEN
    )
    if (!hasReview) {
      const reviewCandidate = sorted.find(
        (t) =>
          t.mastery_score >= REVIEW_MASTERY_MIN &&
          t.mastery_score <= REVIEW_MASTERY_MAX &&
          t.days_since_seen >= REVIEW_MIN_DAYS_SINCE_SEEN &&
          !selected.some((s) => s.id === t.id)
      )
      if (reviewCandidate) {
        selected = ensureIncluded(selected, reviewCandidate, MAX_TOPICS)
        notes.push(`Added ${reviewCandidate.name} for review — not seen in ${reviewCandidate.days_since_seen} days`)
      }
    }
  }

  // Phase 10: onboarding is always exactly 3 questions (1 MC, 1
  // conceptual, 1 MC — see Session.tsx's mode-aware question-type cycle)
  // regardless of how many topics (1 or 2) were actually selected above.
  const targetQuestionCount =
    mode === 'onboarding' ? ONBOARDING_QUESTION_COUNT : selected.length * QUESTIONS_PER_TOPIC

  const targetDuration =
    mode === 'onboarding'
      ? ONBOARDING_QUESTION_COUNT * MINUTES_PER_MC
      : mode === 'exam-crunch'
        ? crunchEffectiveTargetMinutes
        : targetDurationMinutes

  return {
    mode,
    topics: selected,
    target_question_count: targetQuestionCount,
    target_duration_minutes: targetDuration,
    notes,
    allowed_question_types: allowedQuestionTypes
  }
}
