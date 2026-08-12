import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { postBankFill } from '../../src/lib/triggerBankFill.js'

const SEEN_STALE_DAYS = 60
const MS_PER_DAY = 86_400_000

// key_reasoning and each option's distractor_note are grading aids —
// stripping them here is what actually enforces "the client never sees
// the answer key," not just convention.
function stripGradingAids(question) {
  const { key_reasoning, options, ...rest } = question
  const strippedOptions = Array.isArray(options) ? options.map(({ distractor_note, ...opt }) => opt) : options
  return { ...rest, options: strippedOptions }
}

function triggerFillInBackground(packId, topicId, questionType) {
  postBankFill({ packId, topicId, questionType }).catch((err) =>
    console.error('[bank/serve] async fill trigger failed', err)
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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
