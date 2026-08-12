import { getUserFromRequest } from '../_lib/supabaseAdmin.js'

// Stub for Phase 2: fetch/generate questions from question_bank for a given
// pack_id + topic_id, generating via Claude on cache miss.
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

  res.status(200).json({ ok: true, route: 'bank', userId: user.id })
}
