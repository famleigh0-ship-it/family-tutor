import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { parseClaudeJson } from '../_lib/claudeJson.js'
import { getPack } from '../../src/packs/loader.js'
import { callClaude, getModel } from '../../src/lib/claude.js'

const FILL_BATCH_SIZE = { mc: 10, conceptual: 5, frq: 3 }
const TASK_FOR_TYPE = { mc: 'bank_fill_mc', conceptual: 'bank_fill_conceptual', frq: 'bank_fill_frq' }

function findTopic(pack, topicId) {
  for (const unit of pack.units) {
    const topic = unit.topics.find((t) => t.id === topicId)
    if (topic) return topic
  }
  return null
}

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

function buildPrompt(pack, topic, questionType, n) {
  const personaContext = `${pack.tutor_persona}\n${pack.subject_context}`

  if (questionType === 'mc') {
    return {
      system: `${personaContext}\n\nYou generate multiple choice questions for AP exam practice.\nEach question must:\n- Test understanding, not just recall\n- Have exactly one clearly correct answer\n- Have three plausible distractors that reflect common errors\n- Include a brief explanation of why each option is right or wrong\nReturn JSON only, no other text.`,
      user: `Generate ${n} multiple choice questions for this topic:\nTopic: ${topic.name}\nDifficulty: ${topic.difficulty}/3\nCommon errors to incorporate as distractors: ${JSON.stringify(topic.common_errors)}\nHints for question design: ${JSON.stringify(topic.prompt_hints)}\n\nReturn this exact JSON array:\n[{\n  "question_text": "...",\n  "options": [\n    { "label": "A", "text": "...", "is_correct": false, "distractor_note": "why students pick this" },\n    { "label": "B", "text": "...", "is_correct": true, "distractor_note": null },\n    { "label": "C", "text": "...", "is_correct": false, "distractor_note": "why students pick this" },\n    { "label": "D", "text": "...", "is_correct": false, "distractor_note": "why students pick this" }\n  ],\n  "correct_answer": "B",\n  "explanation": "full explanation of the correct reasoning",\n  "key_reasoning": ["reasoning element 1", "reasoning element 2"]\n}]`
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
    user: `Generate ${n} FRQ-style questions for this topic:\nTopic: ${topic.name}\nDifficulty: ${topic.difficulty}/3\nCommon errors: ${JSON.stringify(topic.common_errors)}\nHints: ${JSON.stringify(topic.prompt_hints)}\n\nReturn this exact JSON array:\n[{\n  "question_text": "...",\n  "parts": [\n    { "part": "a", "prompt": "...", "points": 2 },\n    { "part": "b", "prompt": "...", "points": 3 }\n  ],\n  "rubric": "detailed rubric for full credit",\n  "correct_answer": "complete worked solution",\n  "explanation": "explanation of key steps and reasoning",\n  "input_mode": "typed" | "photo"\n}]`
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

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
    response = await callClaude({ task, system, messages: [{ role: 'user', content: user }], max_tokens: 4096 })
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
