// Server-side only. This module reads/writes Supabase with the service
// role key and must never be imported from src/pages or src/components —
// only from Vercel serverless functions (api/) or Node scripts.
//
// Plain JS (not .ts) — Vercel's serverless function bundler cannot resolve
// a directly-imported .ts file at runtime. Converted in Phase 6 because
// api/grading/*.js now import recordQuestionResult from here directly.
// See src/packs/loader.js for the original fix (Phase 5).

import { createClient } from '@supabase/supabase-js'
// Explicit extensions: this module is imported directly by
// scripts/test-engine.js under plain Node (no bundler), whose native ESM
// loader — unlike Vite's — requires extensions on relative specifiers.
import { getPack } from '../packs/loader.js'
import { applyDecay, updateMastery } from './mastery.js'
import { detectSessionMode } from './session-mode.js'
import { selectTopics } from './topic-selector.js'
import { getPrioritizedTopicIds } from './unlock.js'
import { checkBankHealth, triggerBankFill } from './bank-manager.js'

const RECENT_SESSIONS_FOR_TOPICS = 2 // "topics from last 2 sessions"
const MS_PER_DAY = 86_400_000

/** @type {import('@supabase/supabase-js').SupabaseClient | undefined} */
let client

function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceRoleKey) {
      throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.')
    }

    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return client
}

/**
 * @param {any} row
 * @returns {import('./types').MasteryRecord}
 */
function rowToMasteryRecord(row) {
  return {
    topic_id: row.topic_id,
    pack_id: row.pack_id,
    mastery_score: row.mastery_score,
    attempts: row.attempts,
    correct: row.correct,
    frq_attempts: row.frq_attempts,
    frq_score_total: row.frq_score_total,
    last_seen: row.last_seen ? new Date(row.last_seen) : null,
    updated_at: new Date(row.updated_at)
  }
}

/** @param {Date} date */
function toDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * @param {{ userId: string, packId: string, targetDurationMinutes: number }} params
 * @returns {Promise<import('./types').SessionPlan & { sessionId: string }>}
 */
export async function startSession(params) {
  const { userId, packId, targetDurationMinutes } = params
  const admin = getSupabaseAdmin()
  const pack = getPack(packId)
  const now = new Date()

  // 1. Load mastery records for this user + pack.
  const { data: masteryRows, error: masteryErr } = await admin
    .from('mastery_records')
    .select('*')
    .eq('user_id', userId)
    .eq('pack_id', packId)

  if (masteryErr) throw masteryErr

  let masteryRecords = (masteryRows ?? []).map(rowToMasteryRecord)

  // 2. Apply decay, write back any records that actually changed.
  const decayed = applyDecay(masteryRecords)
  for (let i = 0; i < decayed.length; i++) {
    if (decayed[i].mastery_score === masteryRecords[i].mastery_score) continue

    const { error } = await admin
      .from('mastery_records')
      .update({ mastery_score: decayed[i].mastery_score, updated_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('pack_id', packId)
      .eq('topic_id', decayed[i].topic_id)

    if (error) throw error
  }
  masteryRecords = decayed

  // 3. Unlocked topic ids from topic_unlock_log.
  const { data: unlockRows, error: unlockErr } = await admin
    .from('topic_unlock_log')
    .select('topic_id')
    .eq('user_id', userId)
    .eq('pack_id', packId)

  if (unlockErr) throw unlockErr

  const unlockedTopicIds = Array.from(new Set((unlockRows ?? []).map((r) => r.topic_id)))

  // 4. Prioritized topic ids — prioritized_until > now, set by
  // unlockTopics/prioritizeTopics (src/engine/unlock.js) when a classroom
  // log is confirmed.
  const prioritizedTopicIds = await getPrioritizedTopicIds(userId, packId)

  // 5. Active quiz prep event: quiz_date >= today, not expired.
  const todayStr = toDateOnly(now)
  const { data: quizPrepRows, error: quizPrepErr } = await admin
    .from('quiz_prep_events')
    .select('*')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .is('expired_at', null)
    .gte('quiz_date', todayStr)
    .order('quiz_date', { ascending: true })
    .limit(1)

  if (quizPrepErr) throw quizPrepErr

  /** @type {import('./types').QuizPrepEvent | null} */
  const activeQuizPrepEvent = quizPrepRows && quizPrepRows.length > 0 ? quizPrepRows[0] : null
  const quizPrepTopicIds = activeQuizPrepEvent?.topic_ids ?? []

  // 6. Session count for this user + pack (before creating this session).
  const { count: sessionCount, error: countErr } = await admin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('pack_id', packId)

  if (countErr) throw countErr

  // recentTopicIds: topics covered in the last 2 sessions.
  const { data: recentSessions, error: recentErr } = await admin
    .from('sessions')
    .select('topics_covered')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .order('started_at', { ascending: false })
    .limit(RECENT_SESSIONS_FOR_TOPICS)

  if (recentErr) throw recentErr

  const recentTopicIds = Array.from(new Set((recentSessions ?? []).flatMap((s) => s.topics_covered ?? [])))

  // 7. Days until exam.
  const examDate = new Date(pack.exam_date)
  const daysUntilExam = Math.ceil((examDate.getTime() - now.getTime()) / MS_PER_DAY)

  // 8. Detect mode.
  const mode = detectSessionMode({
    sessionCount: sessionCount ?? 0,
    daysUntilExam,
    examCrunchWeeks: pack.exam_crunch_weeks,
    activeQuizPrepEvent
  })

  // 9. Select topics.
  const plan = selectTopics({
    pack,
    masteryRecords,
    unlockedTopicIds,
    prioritizedTopicIds,
    mode,
    quizPrepTopicIds,
    recentTopicIds,
    targetDurationMinutes
  })

  // 10. Create the session row.
  const { data: sessionRow, error: sessionErr } = await admin
    .from('sessions')
    .insert({
      user_id: userId,
      pack_id: packId,
      started_at: now.toISOString(),
      questions_attempted: 0,
      questions_correct: 0,
      topics_covered: []
    })
    .select('id')
    .single()

  if (sessionErr || !sessionRow) throw sessionErr ?? new Error('Failed to create session row')

  // 11. Check bank health for each selected topic and fire off async fills
  // for anything running low — deliberately not awaited, so a cold/thin
  // bank never blocks session start. See src/engine/bank-manager.ts.
  if (plan.topics.length > 0) {
    checkAndTriggerBankFills(packId, userId, plan.topics).catch((err) =>
      console.error('[session-orchestrator] bank health check failed', err)
    )
  }

  // 12. Return the plan plus the session id (required by
  // recordQuestionResult/endSession, so it has to travel somehow).
  return { ...plan, sessionId: sessionRow.id }
}

/**
 * @param {string} packId
 * @param {string} userId
 * @param {import('./types').TopicWithState[]} topics
 */
async function checkAndTriggerBankFills(packId, userId, topics) {
  const health = await checkBankHealth(packId, userId)
  const topicIds = new Set(topics.map((t) => t.id))
  const needsFill = health.filter((h) => topicIds.has(h.topic_id) && h.needs_fill)

  for (const entry of needsFill) {
    console.log(
      `[session-orchestrator] bank low for ${entry.topic_id} (${entry.question_type}): ${entry.unseen_by_user} unseen — triggering fill`
    )
    triggerBankFill(packId, entry.topic_id, entry.question_type)
  }
}

/**
 * @param {{ sessionId: string, userId: string, result: import('./types').QuestionResult, tokensUsed?: number | null }} params
 * @returns {Promise<void>}
 */
export async function recordQuestionResult(params) {
  const { sessionId, userId, result, tokensUsed } = params
  const admin = getSupabaseAdmin()

  const { data: sessionRow, error: sessionErr } = await admin
    .from('sessions')
    .select('pack_id, questions_attempted, questions_correct')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !sessionRow) throw sessionErr ?? new Error(`Session ${sessionId} not found`)
  const packId = sessionRow.pack_id

  // 1. Load current mastery record (or default if this is the first
  // attempt at this topic).
  const { data: existing, error: existingErr } = await admin
    .from('mastery_records')
    .select('*')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .eq('topic_id', result.topic_id)
    .maybeSingle()

  if (existingErr) throw existingErr

  /** @type {import('./types').MasteryRecord} */
  const current = existing
    ? rowToMasteryRecord(existing)
    : {
        topic_id: result.topic_id,
        pack_id: packId,
        mastery_score: 0,
        attempts: 0,
        correct: 0,
        frq_attempts: 0,
        frq_score_total: 0,
        last_seen: null,
        updated_at: new Date()
      }

  // 2. Update mastery.
  const updated = updateMastery(current, result)

  // 3. Write mastery_records.
  const { error: upsertErr } = await admin.from('mastery_records').upsert(
    {
      user_id: userId,
      pack_id: packId,
      topic_id: updated.topic_id,
      mastery_score: updated.mastery_score,
      attempts: updated.attempts,
      correct: updated.correct,
      frq_attempts: updated.frq_attempts,
      frq_score_total: updated.frq_score_total,
      last_seen: updated.last_seen?.toISOString() ?? null,
      updated_at: updated.updated_at.toISOString()
    },
    { onConflict: 'user_id,pack_id,topic_id' }
  )

  if (upsertErr) throw upsertErr

  // 4. Write question_log.
  const { error: logErr } = await admin.from('question_log').insert({
    session_id: sessionId,
    user_id: userId,
    pack_id: packId,
    topic_id: result.topic_id,
    question_type: result.question_type,
    correct: result.correct,
    frq_score: result.frq_score ?? null,
    tokens_used: tokensUsed ?? null
  })

  if (logErr) throw logErr

  // 5. Update session row counts.
  const { error: updateSessionErr } = await admin
    .from('sessions')
    .update({
      questions_attempted: sessionRow.questions_attempted + 1,
      questions_correct: sessionRow.questions_correct + (result.correct ? 1 : 0)
    })
    .eq('id', sessionId)

  if (updateSessionErr) throw updateSessionErr
}

/**
 * @param {{ sessionId: string, userId: string }} params
 * @returns {Promise<void>}
 */
export async function endSession(params) {
  const { sessionId, userId } = params
  const admin = getSupabaseAdmin()

  const { data: sessionRow, error: sessionErr } = await admin
    .from('sessions')
    .select('started_at')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !sessionRow) throw sessionErr ?? new Error(`Session ${sessionId} not found`)

  const endedAt = new Date()
  const startedAt = new Date(sessionRow.started_at)
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))

  // Recompute topics_covered authoritatively from question_log, rather
  // than trusting incremental bookkeeping elsewhere.
  const { data: logRows, error: logErr } = await admin.from('question_log').select('topic_id').eq('session_id', sessionId)

  if (logErr) throw logErr

  const topicsCovered = Array.from(new Set((logRows ?? []).map((r) => r.topic_id)))

  const { error: updateErr } = await admin
    .from('sessions')
    .update({
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      topics_covered: topicsCovered
    })
    .eq('id', sessionId)

  if (updateErr) throw updateErr

  // Streak bookkeeping.
  const { data: streakRow, error: streakErr } = await admin.from('streaks').select('*').eq('user_id', userId).maybeSingle()

  if (streakErr) throw streakErr

  const todayStr = toDateOnly(endedAt)
  const yesterday = new Date(endedAt.getTime() - MS_PER_DAY)
  const yesterdayStr = toDateOnly(yesterday)

  let currentStreak = streakRow?.current_streak ?? 0
  let longestStreak = streakRow?.longest_streak ?? 0
  const lastSessionDate = streakRow?.last_session_date ?? null

  if (lastSessionDate === todayStr) {
    // Already counted today — no change.
  } else if (lastSessionDate === yesterdayStr) {
    currentStreak += 1
  } else {
    currentStreak = 1
  }

  if (currentStreak > longestStreak) longestStreak = currentStreak

  const { error: upsertStreakErr } = await admin.from('streaks').upsert(
    {
      user_id: userId,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_session_date: todayStr
    },
    { onConflict: 'user_id' }
  )

  if (upsertStreakErr) throw upsertStreakErr
}
