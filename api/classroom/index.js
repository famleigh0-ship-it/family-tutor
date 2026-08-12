import { getUserFromRequest } from '../_lib/supabaseAdmin.js'

// Stub for Phase 2: parse classroom_logs input (photo/text/checklist) into
// topics_extracted, write topic_unlock_log entries on confirmation.
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

  res.status(200).json({ ok: true, route: 'classroom', userId: user.id })
}
