// Core question-bank generation logic — one batch of questions for a
// pack_id + topic_id + question_type. Plain JS, callable directly
// in-process from anywhere server-side: api/bank/index.js's POST handler,
// its own GET handler's fallback-fill trigger, src/engine/bank-manager.js,
// and scripts/manage-bank.js.
//
// Living here (not inline in api/bank/index.js) is what lets
// scripts/manage-bank.js's bulk fill-all bypass Vercel's serverless
// function timeout entirely — confirmed live that even with maxDuration
// raised to Hobby's 60s ceiling, some individual FRQ/conceptual
// generations still occasionally run long enough to hit
// FUNCTION_INVOCATION_TIMEOUT. Calling this function directly from a
// plain Node script has no such ceiling; the HTTP endpoint stays subject
// to it, which is fine for its actual real-time use (a single async
// trigger), just not for a bulk loop of 100+ calls.

import { createClient } from '@supabase/supabase-js'
import { parseClaudeJson } from './claudeJson.js'
import { getPack } from '../packs/loader.js'
import { callClaude, getModel } from './claude.js'

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

const FILL_BATCH_SIZE = { mc: 10, conceptual: 5, frq: 3 }
const TASK_FOR_TYPE = { mc: 'bank_fill_mc', conceptual: 'bank_fill_conceptual', frq: 'bank_fill_frq' }

// Confirmed live: for math-heavy content (Calc AB→BC especially), Claude
// sometimes writes LaTeX commands like \pm, \infty, \Rightarrow directly
// into the JSON string values. A lone backslash isn't a valid JSON escape
// sequence, so JSON.parse fails on the whole response. Unicode symbols
// sidestep the problem entirely — nothing to escape.
const NOTATION_INSTRUCTION =
  'Use plain Unicode math symbols in all text (×, ÷, ±, ≤, ≥, ≠, →, ⇒, ∞, √, π, ², ³, etc.), never LaTeX commands like \\frac, \\pm, \\infty, \\cdot, or \\Rightarrow — a literal backslash breaks JSON parsing.'

function findTopic(pack, topicId) {
  for (const unit of pack.units) {
    const topic = unit.topics.find((t) => t.id === topicId)
    if (topic) return topic
  }
  return null
}

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

/**
 * @param {{ packId: string, topicId: string, questionType: 'mc' | 'conceptual' | 'frq' }} params
 * @returns {Promise<{ generated: number, topic_id: string, question_type: string }>}
 */
export async function fillBank({ packId, topicId, questionType }) {
  if (!['mc', 'conceptual', 'frq'].includes(questionType)) {
    throw new Error('question_type must be one of mc, conceptual, frq')
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    throw new Error(`Unknown pack "${packId}"`)
  }

  const topic = findTopic(pack, topicId)
  if (!topic) throw new Error(`Unknown topic "${topicId}" in pack "${packId}"`)

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
    throw new Error(`Claude API request failed: ${err.message}`)
  }

  let parsed
  try {
    parsed = parseClaudeJson(response.content)
  } catch {
    throw new Error('Could not parse Claude response as JSON')
  }

  if (!Array.isArray(parsed)) throw new Error('Claude response was not a JSON array')

  const rows = rowsFromParsed(parsed, questionType, pack, topic, model)
  if (rows.length === 0) throw new Error('No valid questions were generated')

  const admin = getSupabaseAdmin()
  const { error: insertErr } = await admin.from('question_bank').insert(rows)
  if (insertErr) throw new Error(`Failed to insert generated questions: ${insertErr.message}`)

  console.log(`[bankFill] ${topicId} (${questionType}): generated ${rows.length}, ${response.tokens_used} tokens`)

  return { generated: rows.length, topic_id: topicId, question_type: questionType }
}
