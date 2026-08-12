// Handles MC, typed (FRQ/conceptual), and photo (FRQ) grading in one
// function — see api/bank/index.js for why (Vercel Hobby's 12-function
// deployment cap). Which path runs is decided by the loaded question's
// question_type together with which body field the client sent
// (selected_option / student_answer / image_base64).

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

async function gradeMc(admin, user, question, body) {
  const { session_id: sessionId, selected_option: selectedOption, time_spent_seconds: timeSpentSeconds } = body

  const options = Array.isArray(question.options) ? question.options : []
  const correct = selectedOption === question.correct_answer
  const selected = options.find((o) => o.label === selectedOption)
  const correctOption = options.find((o) => o.label === question.correct_answer)

  let feedback
  if (correct) {
    feedback = `Correct! ${question.explanation ?? ''}`.trim()
  } else {
    const distractorNote = selected?.distractor_note ? ` ${selected.distractor_note}.` : ''
    feedback = `Not quite.${distractorNote} The correct answer is ${question.correct_answer} because ${
      question.explanation ?? correctOption?.text ?? ''
    }`
  }

  // No Claude call for MC — the answer is deterministic — so tokens_used
  // is always 0 here.
  await updatePendingHistory(admin, user.id, question.id, {
    student_answer: selectedOption,
    correct,
    feedback_given: feedback,
    tokens_used: 0
  })

  await recordQuestionResult({
    sessionId,
    userId: user.id,
    result: {
      topic_id: question.topic_id,
      question_type: 'mc',
      correct,
      time_spent_seconds: typeof timeSpentSeconds === 'number' ? timeSpentSeconds : 0
    },
    tokensUsed: 0
  })

  return { correct, feedback, correct_answer: question.correct_answer, explanation: question.explanation }
}

async function gradeTyped(admin, user, question, body) {
  const { session_id: sessionId, student_answer: studentAnswer, time_spent_seconds: timeSpentSeconds } = body

  const pack = getPack(question.pack_id)
  const task = question.question_type === 'frq' ? 'frq_grading' : 'conceptual_grading'

  const system = `${pack.tutor_persona}\nYou are grading a student's written answer to an AP-style question.\nBe honest and rigorous — do not over-credit vague or incomplete answers. The student must demonstrate understanding of the underlying physics/math, not just state a correct number.\n${pack.frq_rubric.general_guidance}\nReturn JSON only, no other text.`
  const userMessage = `Question: ${question.question_text}\nRubric: ${question.rubric ?? ''}\nKey reasoning elements required: ${JSON.stringify(
    question.key_reasoning ?? []
  )}\nCommon misconceptions to watch for: ${JSON.stringify(
    question.common_misconceptions ?? []
  )}\n\nStudent answer: '${studentAnswer}'\n\nGrade this answer. Return:\n{\n  "correct": true | false,\n  "frq_score": 0-4 | null,\n  "score_normalized": 0.0-1.0,\n  "correct_elements": ["what they got right"],\n  "missing_elements": ["what was missing or wrong"],\n  "misconception_detected": "id or null",\n  "feedback": "encouraging but honest feedback shown to student",\n  "follow_up": "one thing to think about next time"\n}`

  const response = await callClaude({ task, system, messages: [{ role: 'user', content: userMessage }], max_tokens: 1024 })
  const parsed = parseClaudeJson(response.content)

  const correct = Boolean(parsed.correct)
  const frqScore =
    question.question_type === 'frq' && typeof parsed.frq_score === 'number' ? parsed.frq_score : null

  await updatePendingHistory(admin, user.id, question.id, {
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

  return parsed
}

async function gradePhoto(admin, user, question, body) {
  const { session_id: sessionId, image_base64: imageBase64, time_spent_seconds: timeSpentSeconds } = body

  const pack = getPack(question.pack_id)
  const { mediaType, data } = extractImageParts(imageBase64)

  const system = `${pack.tutor_persona}\nYou are grading a student's handwritten work submitted as a photo.\nRead the handwriting carefully. If parts are unclear, note what you could and could not read. Grade based on what is clearly visible — do not penalize for illegibility if the work is substantively correct where readable.\n${pack.frq_rubric.general_guidance}\nReturn JSON only, no other text.`
  const userText = `Question that was asked: ${question.question_text}\nRubric: ${question.rubric ?? ''}\nKey reasoning required: ${JSON.stringify(
    question.key_reasoning ?? []
  )}\n\nGrade the student's handwritten work shown in this image.\nReturn:\n{\n  "readable": true | false,\n  "partially_readable": true | false,\n  "frq_score": 0-4,\n  "score_normalized": 0.0-1.0,\n  "correct_elements": ["what they got right"],\n  "missing_elements": ["what was missing"],\n  "illegible_sections": "describe any unreadable parts",\n  "misconception_detected": "id or null",\n  "feedback": "specific feedback referencing their actual work",\n  "follow_up": "one thing to think about next time"\n}`

  const response = await callClaude({
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
  const parsed = parseClaudeJson(response.content)

  if (parsed.readable === false) {
    return { readable: false, feedback: parsed.feedback ?? 'Could not read the photo clearly — please retake with better lighting.' }
  }

  const frqScore = typeof parsed.frq_score === 'number' ? parsed.frq_score : null
  const correct = frqScore !== null && frqScore >= FRQ_SCORE_CORRECT_THRESHOLD

  await updatePendingHistory(admin, user.id, question.id, {
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

  return parsed
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

  const body = req.body || {}
  const { question_id: questionId, session_id: sessionId } = body
  if (!questionId || !sessionId) {
    res.status(400).json({ error: 'question_id and session_id are required' })
    return
  }

  const admin = getSupabaseAdmin()

  // Uses the authenticated user's id from the verified token, not any
  // user_id the client might send — same reasoning as
  // api/classroom/confirm-log.js.
  const session = await loadOwnedSession(admin, sessionId, user.id)
  if (!session) {
    res.status(403).json({ error: 'Session does not belong to this user' })
    return
  }

  const { data: question, error: questionErr } = await admin.from('question_bank').select('*').eq('id', questionId).maybeSingle()
  if (questionErr) throw questionErr
  if (!question) {
    res.status(400).json({ error: 'Unknown question' })
    return
  }

  try {
    let result
    if (question.question_type === 'mc') {
      if (typeof body.selected_option !== 'string') {
        res.status(400).json({ error: 'selected_option is required for an MC question' })
        return
      }
      result = await gradeMc(admin, user, question, body)
    } else if (typeof body.image_base64 === 'string' && body.image_base64) {
      if (question.question_type !== 'frq') {
        res.status(400).json({ error: 'Photo submissions are only supported for FRQ questions' })
        return
      }
      result = await gradePhoto(admin, user, question, body)
    } else if (typeof body.student_answer === 'string' && body.student_answer.trim()) {
      if (question.question_type !== 'frq' && question.question_type !== 'conceptual') {
        res.status(400).json({ error: 'student_answer grading is only supported for FRQ/conceptual questions' })
        return
      }
      result = await gradeTyped(admin, user, question, body)
    } else {
      res.status(400).json({ error: 'Provide selected_option, student_answer, or image_base64 matching the question type' })
      return
    }

    res.status(200).json(result)
  } catch (err) {
    res.status(502).json({ error: 'Grading failed', detail: err.message })
  }
}
