// Plain JS — see mastery.js header for why.

/** @typedef {import('../packs/types').CoursePack} CoursePack */
/** @typedef {import('../packs/types').Unit} Unit */
/** @typedef {import('../packs/types').Topic} Topic */

const MINUTES_PER_MC = 3
const MINUTES_PER_FRQ = 8
const CRITICAL_MASTERY_THRESHOLD = 0.4
const DECAY_BOOST_DAYS = 14
const EXAM_CRUNCH_WEIGHT_MULTIPLIER = 2.0
const MIN_TOPICS = 2
const MAX_TOPICS = 4
const ONBOARDING_MAX_TOPICS = 3
const QUIZ_PREP_FILLER_FRACTION = 0.25 // "remaining 20-30% of session"
const QUESTIONS_PER_TOPIC = 2 // rough estimate used to size target_question_count
const REVIEW_MASTERY_MIN = 0.6
const REVIEW_MASTERY_MAX = 0.8
const REVIEW_MIN_DAYS_SINCE_SEEN = 5
const MS_PER_DAY = 86_400_000

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
    updated_at: new Date()
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
 *   targetDurationMinutes: number
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
    targetDurationMinutes
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

      candidates.push({
        ...topic,
        unlock_state: prioritizedSet.has(topic.id) ? 'prioritized' : 'unlocked',
        mastery_score: record.mastery_score,
        last_seen: record.last_seen,
        days_since_seen: daysSince(record.last_seen, now),
        priority_score: 0
      })
    }
  }

  if (candidates.length === 0) {
    return {
      mode,
      topics: [],
      target_question_count: 0,
      target_duration_minutes: 0,
      notes: ['No unlocked topics available']
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

    t.priority_score = base * recencyPenalty * prioritizedBoost * criticalBoost * decayBoost
  }

  const sorted = [...candidates].sort((a, b) => b.priority_score - a.priority_score)

  // STEP 3 + 4 — mode-specific selection and question-count sizing.
  /** @type {import('./types').TopicWithState[]} */
  let selected

  if (mode === 'onboarding') {
    selected = sorted.filter((t) => t.difficulty === 1).slice(0, ONBOARDING_MAX_TOPICS)
    notes.push('Onboarding mode — diagnostic questions only')
  } else if (mode === 'quiz-prep') {
    const forced = sorted.filter((t) => quizPrepSet.has(t.id)).slice(0, MAX_TOPICS)
    const nonForced = sorted.filter((t) => !quizPrepSet.has(t.id))
    const fillerBudget = targetDurationMinutes * QUIZ_PREP_FILLER_FRACTION
    const filler = pickByDuration(nonForced, fillerBudget, 0, Math.max(0, MAX_TOPICS - forced.length))
    selected = [...forced, ...filler]

    if (forced.length > 0) {
      notes.push(`Quiz prep mode active for ${forced.map((t) => t.name).join(', ')}`)
    }
  } else if (mode === 'exam-crunch') {
    selected = pickByDuration(sorted, targetDurationMinutes, MIN_TOPICS, MAX_TOPICS)

    if (!selected.some(isFrqCapable)) {
      const frqCandidate = sorted.find((t) => isFrqCapable(t) && !selected.some((s) => s.id === t.id))
      selected = ensureIncluded(selected, frqCandidate, MAX_TOPICS)
    }

    const examDate = new Date(pack.exam_date)
    const daysUntilExam = Math.ceil((examDate.getTime() - now.getTime()) / MS_PER_DAY)
    notes.push(`Exam crunch mode — ${daysUntilExam} days until exam`)
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

  const targetQuestionCount = mode === 'onboarding' ? selected.length : selected.length * QUESTIONS_PER_TOPIC

  const targetDuration = mode === 'onboarding' ? selected.length * MINUTES_PER_MC : targetDurationMinutes

  return {
    mode,
    topics: selected,
    target_question_count: targetQuestionCount,
    target_duration_minutes: targetDuration,
    notes
  }
}
