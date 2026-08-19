// GET   = active event (+ history for a parent) for one student/pack
// POST  = create or replace the active event for a pack (student only)
// PATCH = record a post-quiz result, including 'skipped' (student only)
//
// Combined into one function for the same reason as api/bank/index.js,
// api/grading/grade.js, and api/session/index.js: Vercel Hobby's
// 12-function deployment cap (see README.md, "Notes on file layout").
// There is deliberately no standalone expire.js — auto-expiry lives in
// src/engine/session-orchestrator.js (on session start) and
// scripts/run-pacing-calendar.js (scheduled sweep), neither of which
// needs an HTTP route.

import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getPack } from '../../src/packs/loader.js'
import { getActiveQuizPrepEvent } from '../../src/engine/session-orchestrator.js'
import { prioritizeTopics } from '../../src/engine/unlock.js'
import { localDateStrInTimeZone } from '../../src/lib/localDate.js'

const MS_PER_DAY = 86_400_000
const MIN_DAYS_OUT = 1 // tomorrow — "no same-day quiz prep"
const MAX_DAYS_OUT = 30
const HISTORY_LIMIT_PER_PACK = 5

const MASTERY_DELTA = { good: 0.15, okay: 0.05, rough: -0.1 }
const PRIORITIZE_DAYS_ON_ROUGH = 7

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

// timeZone is the requesting client's own IANA timezone (see
// src/lib/localDate.js) — "days until" is meaningless without knowing whose
// "today" it's relative to; falls back to UTC if omitted.
function daysUntil(dateStr, timeZone) {
  const today = new Date(`${localDateStrInTimeZone(new Date(), timeZone)}T00:00:00.000Z`)
  const target = new Date(`${dateStr}T00:00:00.000Z`)
  return Math.ceil((target.getTime() - today.getTime()) / MS_PER_DAY)
}

function topicNamesFor(pack, topicIds) {
  const nameById = new Map(pack.units.flatMap((u) => u.topics.map((t) => [t.id, t.name])))
  return (topicIds ?? []).map((id) => nameById.get(id) ?? id)
}

function eventSummary(pack, row, timeZone) {
  return {
    id: row.id,
    pack_id: row.pack_id,
    topic_ids: row.topic_ids ?? [],
    topic_names: topicNamesFor(pack, row.topic_ids),
    quiz_date: row.quiz_date,
    days_until_quiz: daysUntil(row.quiz_date, timeZone)
  }
}

function resultSummary(pack, row) {
  return {
    id: row.id,
    topic_names: topicNamesFor(pack, row.topic_ids),
    quiz_date: row.quiz_date,
    post_quiz_result: row.post_quiz_result
  }
}

async function handleGetForStudent(req, res, user) {
  const packId = typeof req.query.pack_id === 'string' ? req.query.pack_id : null
  const timeZone = typeof req.query.tz === 'string' ? req.query.tz : undefined
  if (!packId) {
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

  const active = await getActiveQuizPrepEvent(user.id, packId, timeZone)
  res.status(200).json({ active: active ? eventSummary(pack, active, timeZone) : null })
}

async function handleGetForParent(req, res, user, admin) {
  const studentId = typeof req.query.student_id === 'string' ? req.query.student_id : null
  const timeZone = typeof req.query.tz === 'string' ? req.query.tz : undefined
  if (!studentId) {
    res.status(400).json({ error: 'student_id is required' })
    return
  }

  const { data: link, error: linkErr } = await admin
    .from('family_links')
    .select('student_id')
    .eq('parent_id', user.id)
    .eq('student_id', studentId)
    .maybeSingle()
  if (linkErr) throw linkErr
  if (!link) {
    res.status(403).json({ error: 'Not linked to this student' })
    return
  }

  const { data: rows, error: rowsErr } = await admin
    .from('quiz_prep_events')
    .select('*')
    .eq('user_id', studentId)
    .order('quiz_date', { ascending: false })
  if (rowsErr) throw rowsErr

  const today = localDateStrInTimeZone(new Date(), timeZone)
  /** @type {Record<string, any>} */
  const active = {}
  /** @type {Record<string, any[]>} */
  const history = {}

  for (const row of rows ?? []) {
    let pack
    try {
      pack = getPack(row.pack_id)
    } catch {
      continue // stale/unknown pack id — skip rather than 500 the whole dashboard
    }

    if (row.expired_at === null && row.quiz_date >= today) {
      const existing = active[row.pack_id]
      if (!existing || row.quiz_date < existing.quiz_date) {
        active[row.pack_id] = eventSummary(pack, row, timeZone)
      }
    }

    if (row.post_quiz_result !== null) {
      history[row.pack_id] = history[row.pack_id] ?? []
      if (history[row.pack_id].length < HISTORY_LIMIT_PER_PACK) {
        history[row.pack_id].push(resultSummary(pack, row))
      }
    }
  }

  res.status(200).json({ active, history })
}

async function handleGet(req, res, user, profile, admin) {
  if (profile.role === 'student') return handleGetForStudent(req, res, user)
  if (profile.role === 'parent') return handleGetForParent(req, res, user, admin)
  res.status(403).json({ error: 'Forbidden' })
}

async function handlePost(req, res, user, profile, admin) {
  if (profile.role !== 'student') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { pack_id: packId, topic_ids: topicIds, quiz_date: quizDate, tz: timeZone } = req.body || {}
  if (typeof packId !== 'string' || !packId) {
    res.status(400).json({ error: 'pack_id is required' })
    return
  }
  if (!Array.isArray(topicIds) || topicIds.length === 0) {
    res.status(400).json({ error: 'topic_ids must be a non-empty array' })
    return
  }
  if (typeof quizDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(quizDate)) {
    res.status(400).json({ error: 'quiz_date must be an ISO date (YYYY-MM-DD)' })
    return
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    res.status(400).json({ error: `Unknown pack "${packId}"` })
    return
  }

  const knownTopicIds = new Set(pack.units.flatMap((u) => u.topics.map((t) => t.id)))
  const unknownTopicIds = topicIds.filter((id) => !knownTopicIds.has(id))
  if (unknownTopicIds.length > 0) {
    res.status(400).json({ error: `Unknown topic ids: ${unknownTopicIds.join(', ')}` })
    return
  }

  const daysOut = daysUntil(quizDate, timeZone)
  if (daysOut < MIN_DAYS_OUT || daysOut > MAX_DAYS_OUT) {
    res.status(400).json({ error: `quiz_date must be ${MIN_DAYS_OUT}-${MAX_DAYS_OUT} days from today` })
    return
  }

  const existing = await getActiveQuizPrepEvent(user.id, packId, timeZone)

  let row
  if (existing) {
    const { data, error } = await admin
      .from('quiz_prep_events')
      .update({ topic_ids: topicIds, quiz_date: quizDate })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) throw error
    row = data
  } else {
    const { data, error } = await admin
      .from('quiz_prep_events')
      .insert({ user_id: user.id, pack_id: packId, topic_ids: topicIds, quiz_date: quizDate })
      .select('*')
      .single()
    if (error) throw error
    row = data
  }

  res.status(200).json({ event: eventSummary(pack, row, timeZone) })
}

async function handlePatch(req, res, user, profile, admin) {
  if (profile.role !== 'student') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { event_id: eventId, result } = req.body || {}
  if (typeof eventId !== 'string' || !eventId) {
    res.status(400).json({ error: 'event_id is required' })
    return
  }
  if (!['good', 'okay', 'rough', 'skipped'].includes(result)) {
    res.status(400).json({ error: "result must be 'good', 'okay', 'rough', or 'skipped'" })
    return
  }

  const { data: event, error: eventErr } = await admin
    .from('quiz_prep_events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()
  if (eventErr) throw eventErr

  // Same "don't reveal whether an id exists vs. belongs to someone else"
  // reasoning as api/session/index.js and api/grading/grade.js.
  if (!event || event.user_id !== user.id) {
    res.status(403).json({ error: 'Event does not belong to this user' })
    return
  }

  const nowIso = new Date().toISOString()

  if (result === 'skipped') {
    const { error } = await admin
      .from('quiz_prep_events')
      .update({ post_quiz_result: 'skipped', expired_at: event.expired_at ?? nowIso })
      .eq('id', eventId)
    if (error) throw error

    res.status(200).json({ updated_topics: 0, new_mastery_scores: {} })
    return
  }

  const topicIds = event.topic_ids ?? []
  const { data: masteryRows, error: masteryErr } = await admin
    .from('mastery_records')
    .select('*')
    .eq('user_id', user.id)
    .eq('pack_id', event.pack_id)
    .in('topic_id', topicIds)
  if (masteryErr) throw masteryErr

  const masteryByTopicId = new Map((masteryRows ?? []).map((r) => [r.topic_id, r]))
  const delta = MASTERY_DELTA[result]

  /** @type {Record<string, number>} */
  const newMasteryScores = {}

  for (const topicId of topicIds) {
    const current = masteryByTopicId.get(topicId)
    const newScore = clamp01((current?.mastery_score ?? 0) + delta)
    newMasteryScores[topicId] = newScore

    const { error } = await admin.from('mastery_records').upsert(
      {
        user_id: user.id,
        pack_id: event.pack_id,
        topic_id: topicId,
        mastery_score: newScore,
        attempts: current?.attempts ?? 0,
        correct: current?.correct ?? 0,
        frq_attempts: current?.frq_attempts ?? 0,
        frq_score_total: current?.frq_score_total ?? 0,
        last_seen: current?.last_seen ?? null,
        updated_at: nowIso
      },
      { onConflict: 'user_id,pack_id,topic_id' }
    )
    if (error) throw error
  }

  if (result === 'rough' && topicIds.length > 0) {
    await prioritizeTopics({
      userId: user.id,
      packId: event.pack_id,
      topicIds,
      days: PRIORITIZE_DAYS_ON_ROUGH
    })
  }

  const { error: updateEventErr } = await admin
    .from('quiz_prep_events')
    .update({ post_quiz_result: result, expired_at: event.expired_at ?? nowIso })
    .eq('id', eventId)
  if (updateEventErr) throw updateEventErr

  res.status(200).json({ updated_topics: topicIds.length, new_mastery_scores: newMasteryScores })
}

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getUserProfile(user.id)
  if (!profile) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const admin = getSupabaseAdmin()

  try {
    if (req.method === 'GET') return await handleGet(req, res, user, profile, admin)
    if (req.method === 'POST') return await handlePost(req, res, user, profile, admin)
    if (req.method === 'PATCH') return await handlePatch(req, res, user, profile, admin)
    res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    res.status(500).json({ error: 'Request failed', detail: err.message })
  }
}
