import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { loadOwnedSession, updatePendingHistory } from '../_lib/grading.js'
import { getPack } from '../../src/packs/loader.js'
import { callClaude } from '../../src/lib/claude.js'
import { parseClaudeJson } from '../_lib/claudeJson.js'
import { recordQuestionResult } from '../../src/engine/session-orchestrator.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

  const {
    question_id: questionId,
    session_id: sessionId,
    student_answer: studentAnswer,
    time_spent_seconds: timeSpentSeconds
  } = req.body || {}

  if (!questionId || !sessionId || typeof studentAnswer !== 'string' || !studentAnswer.trim()) {
    res.status(400).json({ error: 'question_id, session_id, and student_answer are required' })
    return
  }

  const admin = getSupabaseAdmin()

  const session = await loadOwnedSession(admin, sessionId, user.id)
  if (!session) {
    res.status(403).json({ error: 'Session does not belong to this user' })
    return
  }

  const { data: question, error: questionErr } = await admin.from('question_bank').select('*').eq('id', questionId).maybeSingle()
  if (questionErr) throw questionErr
  if (!question || (question.question_type !== 'frq' && question.question_type !== 'conceptual')) {
    res.status(400).json({ error: 'Unknown or non-typed question' })
    return
  }

  const pack = getPack(question.pack_id)
  const task = question.question_type === 'frq' ? 'frq_grading' : 'conceptual_grading'

  const system = `${pack.tutor_persona}\nYou are grading a student's written answer to an AP-style question.\nBe honest and rigorous — do not over-credit vague or incomplete answers. The student must demonstrate understanding of the underlying physics/math, not just state a correct number.\n${pack.frq_rubric.general_guidance}\nReturn JSON only, no other text.`
  const userMessage = `Question: ${question.question_text}\nRubric: ${question.rubric ?? ''}\nKey reasoning elements required: ${JSON.stringify(
    question.key_reasoning ?? []
  )}\nCommon misconceptions to watch for: ${JSON.stringify(
    question.common_misconceptions ?? []
  )}\n\nStudent answer: '${studentAnswer}'\n\nGrade this answer. Return:\n{\n  "correct": true | false,\n  "frq_score": 0-4 | null,\n  "score_normalized": 0.0-1.0,\n  "correct_elements": ["what they got right"],\n  "missing_elements": ["what was missing or wrong"],\n  "misconception_detected": "id or null",\n  "feedback": "encouraging but honest feedback shown to student",\n  "follow_up": "one thing to think about next time"\n}`

  let response
  try {
    response = await callClaude({ task, system, messages: [{ role: 'user', content: userMessage }], max_tokens: 1024 })
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

  const correct = Boolean(parsed.correct)
  const frqScore =
    question.question_type === 'frq' && typeof parsed.frq_score === 'number' ? parsed.frq_score : null

  await updatePendingHistory(admin, user.id, questionId, {
    student_answer: studentAnswer,
    correct,
    frq_score: frqScore,
    feedback_given: parsed.feedback ?? null,
    tokens_used: response.tokens_used
  })

  await recordQuestionResult({
    sessionId,
    userId: user.id,
    result: {
      topic_id: question.topic_id,
      question_type: question.question_type,
      correct,
      frq_score: frqScore ?? undefined,
      time_spent_seconds: typeof timeSpentSeconds === 'number' ? timeSpentSeconds : 0
    },
    tokensUsed: response.tokens_used
  })

  res.status(200).json(parsed)
}
