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
import { selectTopics, QUESTIONS_PER_TOPIC } from './topic-selector.js'
import { getPrioritizedTopicIds } from './unlock.js'
import { checkBankHealth, triggerBankFill } from './bank-manager.js'

const RECENT_SESSIONS_FOR_TOPICS = 2 // "topics from last 2 sessions"
const MS_PER_DAY = 86_400_000
// A post-quiz prompt older than this is "too stale to be useful" — see
// the startSession auto-expiry step below and api/quiz-prep/index.js.
const POST_QUIZ_STALE_DAYS = 14

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
 * The nearest not-expired, not-yet-passed quiz_prep_event for this user +
 * pack, or null. Fetches all matches rather than `.limit(1)` so a "shouldn't
 * happen but handle it" duplicate-active-event state can be logged instead
 * of silently picked. Used by startSession (step 5 below) and by
 * api/quiz-prep/index.js's GET handler (the client never queries
 * quiz_prep_events directly — no RLS policy exists for it, same as
 * sessions/mastery_records).
 * @param {string} userId
 * @param {string} packId
 * @returns {Promise<import('./types').QuizPrepEvent | null>}
 */
export async function getActiveQuizPrepEvent(userId, packId) {
  const admin = getSupabaseAdmin()
  const todayStr = toDateOnly(new Date())

  const { data, error } = await admin
    .from('quiz_prep_events')
    .select('*')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .is('expired_at', null)
    .gte('quiz_date', todayStr)

  if (error) throw error
  if (!data || data.length === 0) return null

  if (data.length > 1) {
    console.warn(
      `[session-orchestrator] ${data.length} active quiz_prep_events for ${userId}/${packId} — using the nearest quiz_date`
    )
  }

  return [...data].sort((a, b) => new Date(a.quiz_date).getTime() - new Date(b.quiz_date).getTime())[0]
}

/**
 * @param {{ userId: string, packId: string, targetDurationMinutes: number, forceTopicIds?: string[] }} params
 * @returns {Promise<(import('./types').SessionPlan & { sessionId: string }) | import('./types').RequiresPostQuiz>}
 */
export async function startSession(params) {
  const { userId, packId, targetDurationMinutes, forceTopicIds } = params
  const admin = getSupabaseAdmin()
  const pack = getPack(packId)
  const now = new Date()

  // 0. Auto-expire any quiz_prep_events whose quiz date has passed for
  // this user + pack, and find any still-unanswered one to gate on.
  // scripts/run-pacing-calendar.js runs the same expiry sweep on a
  // schedule, so this isn't the only place stale events get cleaned up —
  // it just also has to happen here so a student who opens the app the
  // day after a quiz gets gated on the post-quiz prompt immediately, not
  // only after the next scheduled run.
  //
  // Keyed off post_quiz_result IS NULL, not expired_at IS NULL: expired_at
  // gets set the *first* time this row is seen (below), but "Skip for
  // now" (PostQuizPrompt.tsx, skips 1-2) only dismisses the modal
  // client-side — it never touches the row. Filtering on expired_at would
  // mean this query stops finding the row after that first pass, so the
  // gate would never fire again on a later session-start attempt even
  // though the spec wants it to ("prompt returns next session if still
  // unanswered"). post_quiz_result stays a reliable "still needs an
  // answer" signal across any number of visits.
  const todayStrForExpiry = toDateOnly(now)
  const { data: unresolvedQuizPrepRows, error: unresolvedQuizPrepErr } = await admin
    .from('quiz_prep_events')
    .select('*')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .lt('quiz_date', todayStrForExpiry)
    .is('post_quiz_result', null)

  if (unresolvedQuizPrepErr) throw unresolvedQuizPrepErr

  const needsPostQuizPrompt = []
  for (const row of unresolvedQuizPrepRows ?? []) {
    const daysSinceQuiz = Math.floor((now.getTime() - new Date(row.quiz_date).getTime()) / MS_PER_DAY)
    const tooStaleForPrompt = daysSinceQuiz > POST_QUIZ_STALE_DAYS

    if (tooStaleForPrompt) {
      const { error: expireErr } = await admin
        .from('quiz_prep_events')
        .update({ expired_at: row.expired_at ?? now.toISOString(), post_quiz_result: 'skipped' })
        .eq('id', row.id)
      if (expireErr) throw expireErr
      continue
    }

    // Idempotent: only write expired_at the first time it's seen, but
    // still surface the prompt on every subsequent unanswered visit.
    if (row.expired_at === null) {
      const { error: expireErr } = await admin
        .from('quiz_prep_events')
        .update({ expired_at: now.toISOString() })
        .eq('id', row.id)
      if (expireErr) throw expireErr
    }

    needsPostQuizPrompt.push({ ...row, daysSinceQuiz })
  }

  if (needsPostQuizPrompt.length > 0) {
    if (needsPostQuizPrompt.length > 1) {
      console.warn(
        `[session-orchestrator] ${needsPostQuizPrompt.length} quiz_prep_events need a post-quiz prompt for ${userId}/${packId} — using the most recent`
      )
    }
    const toPrompt = needsPostQuizPrompt.sort(
      (a, b) => new Date(b.quiz_date).getTime() - new Date(a.quiz_date).getTime()
    )[0]
    const topicNameById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t.name])))

    return {
      requires_post_quiz: true,
      event_id: toPrompt.id,
      topic_names: (toPrompt.topic_ids ?? []).map((id) => topicNameById.get(id) ?? id),
      days_since_quiz: toPrompt.daysSinceQuiz
    }
  }

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
  const activeQuizPrepEvent = await getActiveQuizPrepEvent(userId, packId)
  const quizPrepTopicIds = activeQuizPrepEvent?.topic_ids ?? []
  const quizPrepDaysUntilQuiz = activeQuizPrepEvent
    ? Math.ceil((new Date(activeQuizPrepEvent.quiz_date).getTime() - now.getTime()) / MS_PER_DAY)
    : undefined

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
    targetDurationMinutes,
    quizPrepDaysUntilQuiz,
    forceTopicIds
  })

  // 9b. Quiz-prep only: drop any selected topic whose bank is entirely
  // empty (all three question types) rather than serving her a topic
  // /api/bank can't actually fill a question for. Still triggers the same
  // async fill checkAndTriggerBankFills (step 11) would have — done here
  // directly since the topic no longer appears in plan.topics for that
  // step to find.
  if (plan.mode === 'quiz-prep' && plan.topics.length > 0) {
    const quizPrepBankHealth = await checkBankHealth(packId, userId)
    const totalInBankByTopic = new Map()
    for (const h of quizPrepBankHealth) {
      totalInBankByTopic.set(h.topic_id, (totalInBankByTopic.get(h.topic_id) ?? 0) + h.total_in_bank)
    }

    const emptyTopics = plan.topics.filter((t) => (totalInBankByTopic.get(t.id) ?? 0) === 0)
    if (emptyTopics.length > 0) {
      const emptyIds = new Set(emptyTopics.map((t) => t.id))
      plan.topics = plan.topics.filter((t) => !emptyIds.has(t.id))
      plan.target_question_count = plan.topics.length * QUESTIONS_PER_TOPIC

      for (const t of emptyTopics) {
        plan.notes.push(`Bank filling for ${t.name}`)
        for (const questionType of ['mc', 'conceptual', 'frq']) {
          triggerBankFill(packId, t.id, questionType)
        }
      }
    }
  }

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

  // Guards against a real failure mode from the Phase 7 session UI: a
  // client-side grading timeout (AbortController) only stops the client
  // from waiting — it doesn't stop this serverless function from
  // finishing, since recordQuestionResult already runs before the HTTP
  // response is sent. If the student then hits Retry, the timed-out first
  // attempt can still land here a second time for the same question,
  // double-counting it in mastery_records/question_log/sessions. Confirmed
  // live: two POSTs to /api/grading/grade for one on-screen submission,
  // one aborted client-side, both completing server-side.
  if (result.question_id) {
    const { data: existingLog, error: existingLogErr } = await admin
      .from('question_log')
      .select('id')
      .eq('session_id', sessionId)
      .eq('question_id', result.question_id)
      .maybeSingle()
    if (existingLogErr) throw existingLogErr
    if (existingLog) return
  }

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
    question_id: result.question_id ?? null,
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
