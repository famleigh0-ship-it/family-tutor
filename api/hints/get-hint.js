import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getPack } from '../../src/packs/loader.js'
import { callClaude } from '../../src/lib/claude.js'

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

  const { question_id: questionId, student_answer_so_far: studentAnswerSoFar } = req.body || {}
  if (!questionId) {
    res.status(400).json({ error: 'question_id is required' })
    return
  }

  const admin = getSupabaseAdmin()
  const { data: question, error: questionErr } = await admin.from('question_bank').select('*').eq('id', questionId).maybeSingle()
  if (questionErr) throw questionErr
  if (!question) {
    res.status(400).json({ error: 'Unknown question' })
    return
  }

  const pack = getPack(question.pack_id)
  // Deliberately stops at rubric, never falls back to correct_answer — the
  // rubric describes what a full-credit answer needs without spelling out
  // the actual worked solution, so even a fully-compliant hint response
  // has nothing more than that to draw on. Handing an LLM the literal
  // answer and just asking it not to reveal it is fragile; not giving it
  // the answer at all is the actual guarantee.
  const keyReasoning = question.key_reasoning ?? question.rubric ?? ''

  const system = `${pack.tutor_persona}\nYou provide Socratic hints — you guide the student toward the answer without giving it away. Ask a question that helps them think through the next step. Never state the answer directly. Never show the full solution. Be encouraging.`
  const userMessage = `Question: ${question.question_text}\nCorrect answer/key reasoning: ${JSON.stringify(
    keyReasoning
  )}\nStudent's work so far: '${
    typeof studentAnswerSoFar === 'string' && studentAnswerSoFar.trim() ? studentAnswerSoFar : 'nothing yet'
  }'\n\nGive one Socratic hint that helps them make progress without revealing the answer. 2-3 sentences maximum.`

  let response
  try {
    response = await callClaude({
      task: 'hint_generation',
      system,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 256
    })
  } catch (err) {
    res.status(502).json({ error: 'Claude API request failed', detail: err.message })
    return
  }

  res.status(200).json({ hint: response.content.trim(), tokens_used: response.tokens_used })
}
