// Shared helpers for the three grading routes (grade-mc, grade-typed,
// grade-photo) — session ownership checks and the pending
// student_question_history row that bank/serve.js inserted when the
// question was first served.

/**
 * Returns the session row if it belongs to userId, or null otherwise
 * (unknown session id or a different user's session — same response
 * either way so we don't leak which session ids exist).
 */
export async function loadOwnedSession(admin, sessionId, userId) {
  const { data: session, error } = await admin.from('sessions').select('id, user_id, pack_id').eq('id', sessionId).maybeSingle()
  if (error) throw error
  if (!session || session.user_id !== userId) return null
  return session
}

// bank/serve.js inserts a student_question_history row with
// student_answer: null when the question is served — this fills it in
// once the student actually answers. If somehow no pending row exists
// (e.g. a question graded outside the normal serve flow), grading still
// proceeds; only this bookkeeping update is skipped.
export async function updatePendingHistory(admin, userId, questionId, updates) {
  const { data: pending, error: findErr } = await admin
    .from('student_question_history')
    .select('id')
    .eq('user_id', userId)
    .eq('question_id', questionId)
    .is('student_answer', null)
    .order('seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (findErr) throw findErr
  if (!pending) return

  const { error: updateErr } = await admin.from('student_question_history').update(updates).eq('id', pending.id)
  if (updateErr) throw updateErr
}
