import { getUserFromRequest } from '../_lib/supabaseAdmin.js'

// Stub for Phase 2: grade FRQ/conceptual answers via Claude, write to
// student_question_history and question_log.
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

  res.status(200).json({ ok: true, route: 'grading', userId: user.id })
}
