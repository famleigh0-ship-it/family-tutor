// GET  = serve (pick a question for a student)
// POST = fill  (generate + store a batch of questions)
//
// Combined into one function because Vercel's Hobby plan caps a
// deployment at 12 serverless functions — every file under api/ counts
// (except api/_lib/, which Vercel's underscore convention excludes), and
// Phase 6 pushed the real total to 13. See the README's Phase 6 section
// for the full breakdown.
//
// The actual generation logic lives in src/lib/bankFill.js, callable
// in-process — not just from this HTTP handler, but directly from
// scripts/manage-bank.js's bulk fill-all, which is what lets a bulk run
// bypass Vercel's function timeout entirely. See that file's header.

import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { fillBank } from '../../src/lib/bankFill.js'

const SEEN_STALE_DAYS = 60
const MS_PER_DAY = 86_400_000

// -------------------------------------------------------------------
// GET — serve
// -------------------------------------------------------------------

// Grading aids — stripping these is what actually enforces "the client
// never sees the answer key" before submitting, not just convention.
// Broader than the spec's literal "distractor_notes and key_reasoning"
// list: correct_answer, explanation, rubric, and common_misconceptions
// all reveal the answer just as directly, and each option's own
// is_correct flag is a direct boolean answer key — leaving any of those
// in the served response would make the "never seen" question selection
// in handleServe pointless, since the client could just read the answer
// out of the API response instead of answering.
function stripGradingAids(question) {
  const { key_reasoning, correct_answer, explanation, rubric, common_misconceptions, options, ...rest } = question
  const strippedOptions = Array.isArray(options)
    ? options.map(({ distractor_note, is_correct, ...opt }) => opt)
    : options
  return { ...rest, options: strippedOptions }
}

// Fire-and-forget — not awaited by the caller, so a slow or failed fill
// never delays the response the student is waiting on.
function triggerFillInBackground(packId, topicId, questionType) {
  fillBank({ packId, topicId, questionType }).catch((err) =>
    console.error('[bank/serve] async fill trigger failed', err)
  )
}

async function handleServe(req, res) {
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

  const { pack_id: packId, topic_id: topicId, question_type: questionType, difficulty } = req.query
  const difficultyNum = Number(difficulty)
  if (!packId || !topicId || !questionType || !Number.isFinite(difficultyNum)) {
    res.status(400).json({ error: 'pack_id, topic_id, question_type, and difficulty are required' })
    return
  }

  const admin = getSupabaseAdmin()

  const { data: candidates, error: candErr } = await admin
    .from('question_bank')
    .select('*')
    .eq('pack_id', packId)
    .eq('topic_id', topicId)
    .eq('question_type', questionType)
    .eq('difficulty', difficultyNum)

  if (candErr) throw candErr

  if (!candidates || candidates.length === 0) {
    // Bank is completely empty for this topic/type/difficulty.
    triggerFillInBackground(packId, topicId, questionType)
    res.status(503).json({ error: 'No questions available yet — bank fill triggered, try again shortly.' })
    return
  }

  const questionIds = candidates.map((q) => q.id)
  const { data: historyRows, error: histErr } = await admin
    .from('student_question_history')
    .select('question_id, seen_at')
    .eq('user_id', user.id)
    .in('question_id', questionIds)
  if (histErr) throw histErr

  // Only the most recent seen_at per question matters for staleness.
  const lastSeenByQuestion = new Map()
  for (const row of historyRows ?? []) {
    const seenAt = new Date(row.seen_at).getTime()
    const prev = lastSeenByQuestion.get(row.question_id)
    if (prev === undefined || seenAt > prev) lastSeenByQuestion.set(row.question_id, seenAt)
  }

  const now = Date.now()
  const unseen = candidates.filter((q) => !lastSeenByQuestion.has(q.id))
  const stale = candidates.filter((q) => {
    const seenAt = lastSeenByQuestion.get(q.id)
    return seenAt !== undefined && now - seenAt >= SEEN_STALE_DAYS * MS_PER_DAY
  })

  let selected
  let bankFillTriggered = false

  if (unseen.length > 0) {
    selected = unseen[Math.floor(Math.random() * unseen.length)]
  } else if (stale.length > 0) {
    selected = stale[Math.floor(Math.random() * stale.length)]
  } else {
    // Exhausted — everything's been seen recently. Trigger a fill so
    // future requests have fresher material, but this student still
    // needs a question right now: fall back to least-recently-seen.
    bankFillTriggered = true
    triggerFillInBackground(packId, topicId, questionType)
    selected = candidates.reduce((oldest, q) => {
      const seenAt = lastSeenByQuestion.get(q.id) ?? 0
      const oldestSeenAt = lastSeenByQuestion.get(oldest.id) ?? 0
      return seenAt < oldestSeenAt ? q : oldest
    })
  }

  const { error: insertErr } = await admin.from('student_question_history').insert({
    user_id: user.id,
    question_id: selected.id,
    seen_at: new Date().toISOString(),
    student_answer: null
  })
  if (insertErr) throw insertErr

  res.status(200).json({ question: stripGradingAids(selected), bank_fill_triggered: bankFillTriggered })
}

// -------------------------------------------------------------------
// POST — fill
// -------------------------------------------------------------------

// Internal endpoint — only our own backend (bank-manager.js's
// triggerBankFill) should ever call this over HTTP, never a logged-in
// student directly. scripts/manage-bank.js calls fillBank directly
// in-process instead of hitting this endpoint, so it isn't bound by
// Vercel's function timeout for bulk operations. There's no "service
// role" concept for our own HTTP API the way there is for Supabase, so
// the already-guarded Supabase service role key doubles as the shared
// secret here rather than inventing a second internal-only credential.
function isServiceRoleCaller(req) {
  const key = req.headers['x-service-role-key']
  return typeof key === 'string' && key.length > 0 && key === process.env.SUPABASE_SERVICE_ROLE_KEY
}

async function handleFill(req, res) {
  if (!isServiceRoleCaller(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { pack_id: packId, topic_id: topicId, question_type: questionType } = req.body || {}

  try {
    const result = await fillBank({ packId, topicId, questionType })
    res.status(200).json(result)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
}

// -------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method === 'GET') return handleServe(req, res)
  if (req.method === 'POST') return handleFill(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
