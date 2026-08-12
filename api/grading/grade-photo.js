import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { loadOwnedSession, updatePendingHistory } from '../_lib/grading.js'
import { getPack } from '../../src/packs/loader.js'
import { callClaude } from '../../src/lib/claude.js'
import { parseClaudeJson } from '../_lib/claudeJson.js'
import { recordQuestionResult } from '../../src/engine/session-orchestrator.js'

// 3-4 out of 4 counts as "correct" for the mastery_records.correct tally
// and streak-style bookkeeping — the real mastery-score update uses
// frq_score/4 directly (see src/engine/mastery.js), so this threshold only
// affects the auxiliary counter, not the actual EMA calculation.
const FRQ_SCORE_CORRECT_THRESHOLD = 3

// Accepts either a raw base64 string or a data: URL and returns the media
// type + bare base64 payload Claude's image block expects.
function extractImageParts(imageBase64) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/s.exec(imageBase64)
  if (match) return { mediaType: match[1], data: match[2] }
  return { mediaType: 'image/jpeg', data: imageBase64 }
}

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
    image_base64: imageBase64,
    time_spent_seconds: timeSpentSeconds
  } = req.body || {}

  if (!questionId || !sessionId || typeof imageBase64 !== 'string' || !imageBase64) {
    res.status(400).json({ error: 'question_id, session_id, and image_base64 are required' })
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
  if (!question || question.question_type !== 'frq') {
    res.status(400).json({ error: 'Unknown or non-FRQ question' })
    return
  }

  const pack = getPack(question.pack_id)
  const { mediaType, data } = extractImageParts(imageBase64)

  const system = `${pack.tutor_persona}\nYou are grading a student's handwritten work submitted as a photo.\nRead the handwriting carefully. If parts are unclear, note what you could and could not read. Grade based on what is clearly visible — do not penalize for illegibility if the work is substantively correct where readable.\n${pack.frq_rubric.general_guidance}\nReturn JSON only, no other text.`
  const userText = `Question that was asked: ${question.question_text}\nRubric: ${question.rubric ?? ''}\nKey reasoning required: ${JSON.stringify(
    question.key_reasoning ?? []
  )}\n\nGrade the student's handwritten work shown in this image.\nReturn:\n{\n  "readable": true | false,\n  "partially_readable": true | false,\n  "frq_score": 0-4,\n  "score_normalized": 0.0-1.0,\n  "correct_elements": ["what they got right"],\n  "missing_elements": ["what was missing"],\n  "illegible_sections": "describe any unreadable parts",\n  "misconception_detected": "id or null",\n  "feedback": "specific feedback referencing their actual work",\n  "follow_up": "one thing to think about next time"\n}`

  let response
  try {
    response = await callClaude({
      task: 'frq_grading',
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            { type: 'text', text: userText }
          ]
        }
      ],
      max_tokens: 1024
    })
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

  if (parsed.readable === false) {
    res.status(200).json({
      readable: false,
      feedback: parsed.feedback ?? 'Could not read the photo clearly — please retake with better lighting.'
    })
    return
  }

  const frqScore = typeof parsed.frq_score === 'number' ? parsed.frq_score : null
  const correct = frqScore !== null && frqScore >= FRQ_SCORE_CORRECT_THRESHOLD

  await updatePendingHistory(admin, user.id, questionId, {
    student_answer: '[photo submission]',
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
      question_type: 'frq',
      correct,
      frq_score: frqScore ?? undefined,
      time_spent_seconds: typeof timeSpentSeconds === 'number' ? timeSpentSeconds : 0
    },
    tokensUsed: response.tokens_used
  })

  res.status(200).json(parsed)
}
