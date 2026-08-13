// GET  = serve (pick a question for a student)
// POST = fill  (generate + store a batch of questions)
//
// Combined into one function because Vercel's Hobby plan caps a
// deployment at 12 serverless functions — every file under api/ counts
// (except api/_lib/, which Vercel's underscore convention excludes), and
// Phase 6 pushed the real total to 13. See the README's Phase 6 section
// for the full breakdown.

import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { parseClaudeJson } from '../_lib/claudeJson.js'
import { getPack } from '../../src/packs/loader.js'
import { callClaude, getModel } from '../../src/lib/claude.js'
import { postBankFill } from '../../src/lib/triggerBankFill.js'

const SEEN_STALE_DAYS = 60
const MS_PER_DAY = 86_400_000
const FILL_BATCH_SIZE = { mc: 10, conceptual: 5, frq: 3 }
const TASK_FOR_TYPE = { mc: 'bank_fill_mc', conceptual: 'bank_fill_conceptual', frq: 'bank_fill_frq' }

function findTopic(pack, topicId) {
  for (const unit of pack.units) {
    const topic = unit.topics.find((t) => t.id === topicId)
    if (topic) return topic
  }
  return null
}

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

function triggerFillInBackground(packId, topicId, questionType) {
  postBankFill({ packId, topicId, questionType }).catch((err) =>
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
// triggerBankFill, or scripts/manage-bank.js) should ever call this, never
// a logged-in student directly. There's no "service role" concept for our
// own HTTP API the way there is for Supabase, so the already-guarded
// Supabase service role key doubles as the shared secret here rather than
// inventing a second internal-only credential.
function isServiceRoleCaller(req) {
  const key = req.headers['x-service-role-key']
  return typeof key === 'string' && key.length > 0 && key === process.env.SUPABASE_SERVICE_ROLE_KEY
}

// Confirmed live: for math-heavy content (Calc AB→BC especially), Claude
// sometimes writes LaTeX commands like \pm, \infty, \Rightarrow directly
// into the JSON string values. A lone backslash isn't a valid JSON escape
// sequence, so JSON.parse fails on the whole response. Unicode symbols
// sidestep the problem entirely — nothing to escape.
const NOTATION_INSTRUCTION =
  'Use plain Unicode math symbols in all text (×, ÷, ±, ≤, ≥, ≠, →, ⇒, ∞, √, π, ², ³, etc.), never LaTeX commands like \\frac, \\pm, \\infty, \\cdot, or \\Rightarrow — a literal backslash breaks JSON parsing.'

function buildPrompt(pack, topic, questionType, n) {
  const personaContext = `${pack.tutor_persona}\n${pack.subject_context}\n${NOTATION_INSTRUCTION}`

  if (questionType === 'mc') {
    return {
      system: `${personaContext}\n\nYou generate multiple choice questions for AP exam practice.\nEach question must:\n- Test understanding, not just recall\n- Have exactly one clearly correct answer\n- Have three plausible distractors that reflect common errors\n- Include a brief explanation of why each option is right or wrong\nReturn JSON only, no other text.`,
      user: `Generate ${n} multiple choice questions for this topic:\nTopic: ${topic.name}\nDifficulty: ${topic.difficulty}/3\nCommon errors to incorporate as distractors: ${JSON.stringify(topic.common_errors)}\nHints for question design: ${JSON.stringify(topic.prompt_hints)}\n\nKeep each explanation to 2-3 sentences, each distractor_note to one sentence, and key_reasoning to at most 2 short items — this is a large batch, so concision matters more than exhaustiveness.\n\nReturn this exact JSON array:\n[{\n  "question_text": "...",\n  "options": [\n    { "label": "A", "text": "...", "is_correct": false, "distractor_note": "why students pick this" },\n    { "label": "B", "text": "...", "is_correct": true, "distractor_note": null },\n    { "label": "C", "text": "...", "is_correct": false, "distractor_note": "why students pick this" },\n    { "label": "D", "text": "...", "is_correct": false, "distractor_note": "why students pick this" }\n  ],\n  "correct_answer": "B",\n  "explanation": "full explanation of the correct reasoning",\n  "key_reasoning": ["reasoning element 1", "reasoning element 2"]\n}]`
    }
  }

  if (questionType === 'conceptual') {
    return {
      system: `${personaContext}\n${pack.frq_rubric.general_guidance}\n\nYou generate conceptual free-response questions for AP exam practice.\nThese questions require written explanation and justification, not just numerical answers. A correct answer with no reasoning scores zero. Return JSON only, no other text.`,
      user: `Generate ${n} conceptual questions for this topic:\nTopic: ${topic.name}\nDifficulty: ${topic.difficulty}/3\nCommon errors to watch for: ${JSON.stringify(topic.common_errors)}\nQuestion design hints: ${JSON.stringify(topic.prompt_hints)}\n\nReturn this exact JSON array:\n[{\n  "question_text": "...",\n  "key_reasoning": [\n    "reasoning element that must appear in a complete answer"\n  ],\n  "rubric": "what a full-credit answer includes",\n  "explanation": "model answer for feedback",\n  "common_misconceptions": ["misconception to watch for"]\n}]`
    }
  }

  // frq
  return {
    system: `${personaContext}\n${pack.frq_rubric.general_guidance}\n${pack.frq_rubric.point_allocation_pattern}\n\nYou generate multi-part free-response questions matching AP exam style. Questions must require shown work and written justification. Return JSON only, no other text.`,
    user: `Generate ${n} FRQ-style questions for this topic:\nTopic: ${topic.name}\nDifficulty: ${topic.difficulty}/3\nCommon errors: ${JSON.stringify(topic.common_errors)}\nHints: ${JSON.stringify(topic.prompt_hints)}\n\nThe parts' point values must sum to exactly 4 — grading elsewhere in this system always scores FRQs on a 0-4 scale regardless of how many parts a question has, so a 2-part question might be 2+2, a 3-part question 1+1+2, and so on.\n\nReturn this exact JSON array:\n[{\n  "question_text": "...",\n  "parts": [\n    { "part": "a", "prompt": "...", "points": 2 },\n    { "part": "b", "prompt": "...", "points": 2 }\n  ],\n  "rubric": "detailed rubric for full credit, matching the 4-point total",\n  "correct_answer": "complete worked solution",\n  "explanation": "explanation of key steps and reasoning",\n  "input_mode": "typed" | "photo"\n}]`
  }
}

function rowsFromParsed(parsed, questionType, pack, topic, model) {
  const base = (q) => ({
    pack_id: pack.id,
    topic_id: topic.id,
    question_type: questionType,
    difficulty: topic.difficulty,
    question_text: q.question_text,
    generation_model: model
  })

  return parsed
    .filter((q) => q && typeof q.question_text === 'string' && q.question_text.trim())
    .map((q) => {
      if (questionType === 'mc') {
        return {
          ...base(q),
          input_mode: 'typed',
          options: q.options ?? null,
          correct_answer: q.correct_answer ?? null,
          key_reasoning: q.key_reasoning ?? null,
          explanation: q.explanation ?? null
        }
      }

      if (questionType === 'conceptual') {
        return {
          ...base(q),
          input_mode: 'typed',
          rubric: q.rubric ?? null,
          key_reasoning: q.key_reasoning ?? null,
          explanation: q.explanation ?? null,
          common_misconceptions: q.common_misconceptions ?? null
        }
      }

      // frq — falls back to the topic's own default input_mode if Claude
      // omits or returns something unexpected.
      return {
        ...base(q),
        input_mode: q.input_mode === 'photo' || q.input_mode === 'typed' ? q.input_mode : topic.input_mode,
        parts: q.parts ?? null,
        rubric: q.rubric ?? null,
        correct_answer: q.correct_answer ?? null,
        explanation: q.explanation ?? null
      }
    })
}

async function handleFill(req, res) {
  if (!isServiceRoleCaller(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { pack_id: packId, topic_id: topicId, question_type: questionType } = req.body || {}
  if (!['mc', 'conceptual', 'frq'].includes(questionType)) {
    res.status(400).json({ error: 'question_type must be one of mc, conceptual, frq' })
    return
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    res.status(400).json({ error: `Unknown pack "${packId}"` })
    return
  }

  const topic = findTopic(pack, topicId)
  if (!topic) {
    res.status(400).json({ error: `Unknown topic "${topicId}" in pack "${packId}"` })
    return
  }

  const n = FILL_BATCH_SIZE[questionType]
  const task = TASK_FOR_TYPE[questionType]
  const model = getModel(task)
  const { system, user } = buildPrompt(pack, topic, questionType, n)

  let response
  try {
    // A batch of 10 verbose MC questions (each with 3 distractor notes,
    // an explanation, and key_reasoning) can run well past 8192 tokens,
    // truncating the JSON array mid-response — confirmed in testing at
    // both 4096 and 8192. Paired with a conciseness instruction in the
    // MC prompt above so this isn't just betting on a bigger ceiling.
    response = await callClaude({ task, system, messages: [{ role: 'user', content: user }], max_tokens: 16000 })
  } catch (err) {
    res.status(502).json({ error: 'Claude API request failed', detail: err.message })
    return
  }

  let parsed
  try {
    parsed = parseClaudeJson(response.content)
  } catch {
    res.status(502).json({ error: 'Could not parse Claude response as JSON', raw: response.content })
    return
  }

  if (!Array.isArray(parsed)) {
    res.status(502).json({ error: 'Claude response was not a JSON array' })
    return
  }

  const rows = rowsFromParsed(parsed, questionType, pack, topic, model)
  if (rows.length === 0) {
    res.status(502).json({ error: 'No valid questions were generated' })
    return
  }

  const admin = getSupabaseAdmin()
  const { error: insertErr } = await admin.from('question_bank').insert(rows)
  if (insertErr) {
    res.status(500).json({ error: 'Failed to insert generated questions', detail: insertErr.message })
    return
  }

  console.log(`[bank/fill] ${topicId} (${questionType}): generated ${rows.length}, ${response.tokens_used} tokens`)

  res.status(200).json({ generated: rows.length, topic_id: topicId, question_type: questionType })
}

// -------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method === 'GET') return handleServe(req, res)
  if (req.method === 'POST') return handleFill(req, res)
  res.status(405).json({ error: 'Method not allowed' })
}
