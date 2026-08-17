// Plain JS (not .ts) so this loads identically under Vite, plain Node
// script execution, AND Vercel's serverless function bundler — which
// cannot resolve a directly-imported .ts file at runtime. Converted in
// Phase 6 because api/grading/*.js now import session-orchestrator.js,
// which imports this. See src/packs/loader.js for the original fix.

const LEARNING_RATE = 0.3
const DECAY_RATE_PER_WEEK = 0.02
const DECAY_GRACE_DAYS = 7
const MS_PER_DAY = 86_400_000

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

function daysBetween(earlier, later) {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY)
}

/**
 * Exponential-moving-average update: each result pulls the score 30% of
 * the way toward a perfect (1.0) or zero (0.0) result, so no single
 * question can swing mastery drastically either direction.
 * @param {import('./types').MasteryRecord} current
 * @param {import('./types').QuestionResult} result
 * @returns {import('./types').MasteryRecord}
 */
export function updateMastery(current, result) {
  const resultScore = result.question_type === 'frq' ? (result.frq_score ?? 0) / 4 : result.correct ? 1 : 0

  const newScore = clamp01(current.mastery_score + LEARNING_RATE * (resultScore - current.mastery_score))
  const isFrq = result.question_type === 'frq'
  const now = new Date()

  return {
    ...current,
    mastery_score: newScore,
    attempts: current.attempts + 1,
    correct: current.correct + (result.correct ? 1 : 0),
    frq_attempts: current.frq_attempts + (isFrq ? 1 : 0),
    frq_score_total: current.frq_score_total + (isFrq ? result.frq_score ?? 0 : 0),
    last_seen: now,
    updated_at: now
  }
}

/**
 * Topics not practiced in over a week fade slightly (2% per week since
 * last seen), floored at 0. Recently-seen topics (<=7 days) are untouched.
 * @param {import('./types').MasteryRecord[]} records
 * @returns {import('./types').MasteryRecord[]}
 */
export function applyDecay(records) {
  const now = new Date()

  return records.map((record) => {
    if (!record.last_seen) return record

    const daysSinceSeen = daysBetween(record.last_seen, now)
    if (daysSinceSeen <= DECAY_GRACE_DAYS) return record

    // Decay magnitude accrues from the last time it was actually computed
    // (updated_at), not re-derived from last_seen on every call. If it
    // were based on last_seen alone, calling applyDecay again a minute
    // later (e.g. a second session started right after the first) would
    // subtract the *full* weeks-since-practiced decay a second time,
    // compounding far past what the elapsed real time justifies. Basing
    // the amount on updated_at — and bumping it below — makes repeated
    // calls idempotent for the same elapsed period.
    const daysSinceUpdate = daysBetween(record.updated_at, now)
    if (daysSinceUpdate <= 0) return record

    const weeksSinceUpdate = daysSinceUpdate / 7
    const decay = weeksSinceUpdate * DECAY_RATE_PER_WEEK
    const newScore = Math.max(0, record.mastery_score - decay)

    if (newScore === record.mastery_score) return record

    console.log(
      `[mastery] decayed ${record.topic_id}: ${record.mastery_score.toFixed(3)} -> ${newScore.toFixed(3)} (${daysSinceSeen} days since last practiced)`
    )

    return { ...record, mastery_score: newScore, updated_at: now }
  })
}

const DIFFICULTY_1_THRESHOLD = 0.7
const DIFFICULTY_2_THRESHOLD = 0.7
const DIFFICULTY_3_THRESHOLD = 0.8

/**
 * NMSQT-only (difficulty_escalation packs): which difficulty to serve next
 * for a topic, based on that topic's own per-difficulty mastery columns.
 * Escalates once the current tier is solid; difficulty 3 has no further
 * tier to escalate to, so a mastered student just keeps getting difficulty
 * 3 for maintenance.
 * @param {import('./types').MasteryRecord} record
 * @returns {1 | 2 | 3}
 */
export function getCurrentDifficulty(record) {
  if ((record.difficulty_1_mastery ?? 0) < DIFFICULTY_1_THRESHOLD) return 1
  if ((record.difficulty_2_mastery ?? 0) < DIFFICULTY_2_THRESHOLD) return 2
  if ((record.difficulty_3_mastery ?? 0) < DIFFICULTY_3_THRESHOLD) return 3
  return 3
}

/**
 * NMSQT-only counterpart to updateMastery: updates the mastery column for
 * the specific difficulty the question was served at (same EMA formula),
 * plus the overall mastery_score/attempts/correct bookkeeping updateMastery
 * already does, then recomputes current_difficulty from the result.
 * @param {import('./types').MasteryRecord} record
 * @param {import('./types').QuestionResult} result
 * @param {1 | 2 | 3} questionDifficulty
 * @returns {import('./types').MasteryRecord}
 */
export function updateDifficultyMastery(record, result, questionDifficulty) {
  const overallUpdated = updateMastery(record, result)

  const resultScore = result.question_type === 'frq' ? (result.frq_score ?? 0) / 4 : result.correct ? 1 : 0
  const key = `difficulty_${questionDifficulty}_mastery`
  const oldDifficultyScore = record[key] ?? 0
  const newDifficultyScore = clamp01(oldDifficultyScore + LEARNING_RATE * (resultScore - oldDifficultyScore))

  const updated = { ...overallUpdated, [key]: newDifficultyScore }
  updated.current_difficulty = getCurrentDifficulty(updated)
  return updated
}

/** @param {number} score */
export function getMasteryLabel(score) {
  if (score >= 0.9) return 'Mastered'
  if (score >= 0.8) return 'Solid'
  if (score >= 0.6) return 'Practicing'
  if (score >= 0.4) return 'Developing'
  return 'Not started'
}
