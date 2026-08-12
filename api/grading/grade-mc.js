import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { loadOwnedSession, updatePendingHistory } from '../_lib/grading.js'
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
    selected_option: selectedOption,
    time_spent_seconds: timeSpentSeconds
  } = req.body || {}

  if (!questionId || !sessionId || typeof selectedOption !== 'string') {
    res.status(400).json({ error: 'question_id, session_id, and selected_option are required' })
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
  if (!question || question.question_type !== 'mc') {
    res.status(400).json({ error: 'Unknown or non-MC question' })
    return
  }

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
  await updatePendingHistory(admin, user.id, questionId, {
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

  res.status(200).json({
    correct,
    feedback,
    correct_answer: question.correct_answer,
    explanation: question.explanation
  })
}
