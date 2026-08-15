// POST  = start (session-orchestrator.startSession)
// PATCH = end   (session-orchestrator.endSession)
//
// Combined into one function for the same reason as api/bank/index.js and
// api/grading/grade.js: Vercel Hobby's 12-function deployment cap. This is
// the first route exposing session-orchestrator.js over HTTP at all —
// previously it was only ever called from scripts/test-engine.js.

import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getPack } from '../../src/packs/loader.js'
import { getMasteryLabel } from '../../src/engine/mastery.js'
import { startSession, endSession } from '../../src/engine/session-orchestrator.js'

// No adaptive session-length logic exists yet (that's a bigger, separate
// concern than this route) — 20 matches the value scripts/test-engine.js
// has used since Phase 4.
const DEFAULT_TARGET_DURATION_MINUTES = 20

function leanTopic(t) {
  return {
    id: t.id,
    name: t.name,
    input_mode: t.input_mode,
    type: t.type,
    difficulty: t.difficulty,
    mastery_score: t.mastery_score,
    mastery_label: getMasteryLabel(t.mastery_score)
  }
}

async function handleStart(req, res, user) {
  const { pack_id: packId } = req.body || {}
  if (typeof packId !== 'string' || !packId) {
    res.status(400).json({ error: 'pack_id is required' })
    return
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    res.status(400).json({ error: `Unknown pack "${packId}"` })
    return
  }

  try {
    const plan = await startSession({
      userId: user.id,
      packId,
      targetDurationMinutes: DEFAULT_TARGET_DURATION_MINUTES
    })

    // Quiz-prep gate: startSession found a quiz_prep_event whose quiz has
    // passed with no post_quiz_result yet, and returned early without
    // creating a session row — see session-orchestrator.js's startSession.
    // The client (Session.tsx) bounces back to /home and shows
    // PostQuizPrompt instead of entering a session.
    if (plan.requires_post_quiz) {
      res.status(200).json({
        requires_post_quiz: true,
        event_id: plan.event_id,
        topic_names: plan.topic_names
      })
      return
    }

    res.status(200).json({
      session_id: plan.sessionId,
      pack_name: pack.name,
      mode: plan.mode,
      topics: plan.topics.map(leanTopic),
      target_question_count: plan.target_question_count,
      target_duration_minutes: plan.target_duration_minutes,
      notes: plan.notes
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to start session', detail: err.message })
  }
}

async function handleEnd(req, res, user) {
  const { session_id: sessionId } = req.body || {}
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ error: 'session_id is required' })
    return
  }

  const admin = getSupabaseAdmin()

  // Same ownership check as api/grading/grade.js — never trust a
  // client-supplied user id, and don't reveal whether an unknown session
  // id exists vs. belongs to someone else.
  const { data: sessionRow, error: sessionErr } = await admin
    .from('sessions')
    .select('id, user_id, pack_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (sessionErr) throw sessionErr
  if (!sessionRow || sessionRow.user_id !== user.id) {
    res.status(403).json({ error: 'Session does not belong to this user' })
    return
  }

  try {
    await endSession({ sessionId, userId: user.id })
  } catch (err) {
    res.status(500).json({ error: 'Failed to end session', detail: err.message })
    return
  }

  const [{ data: finalSession, error: finalErr }, { data: streakRow, error: streakErr }, { data: masteryRows, error: masteryErr }] =
    await Promise.all([
      admin
        .from('sessions')
        .select('duration_seconds, questions_attempted, questions_correct, topics_covered')
        .eq('id', sessionId)
        .single(),
      admin.from('streaks').select('current_streak').eq('user_id', user.id).maybeSingle(),
      admin.from('mastery_records').select('topic_id, mastery_score').eq('user_id', user.id).eq('pack_id', sessionRow.pack_id)
    ])

  if (finalErr) throw finalErr
  if (streakErr) throw streakErr
  if (masteryErr) throw masteryErr

  const pack = getPack(sessionRow.pack_id)
  const topicById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t])))
  const masteryByTopic = new Map((masteryRows ?? []).map((r) => [r.topic_id, r.mastery_score]))

  const topics = (finalSession.topics_covered ?? [])
    .filter((id) => topicById.has(id))
    .map((id) => {
      const score = masteryByTopic.get(id) ?? 0
      return { id, name: topicById.get(id).name, mastery_score: score, mastery_label: getMasteryLabel(score) }
    })

  res.status(200).json({
    duration_seconds: finalSession.duration_seconds,
    questions_attempted: finalSession.questions_attempted,
    questions_correct: finalSession.questions_correct,
    current_streak: streakRow?.current_streak ?? 0,
    topics
  })
}

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getUserProfile(user.id)
  if (!profile || profile.role !== 'student') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  if (req.method === 'POST') return handleStart(req, res, user)
  if (req.method === 'PATCH') return handleEnd(req, res, user)
  res.status(405).json({ error: 'Method not allowed' })
}
