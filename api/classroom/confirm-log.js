import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { getPack } from '../../src/packs/loader.js'
import { unlockTopics, prioritizeTopics } from '../../src/engine/unlock.js'

const VALID_INPUT_METHODS = ['photo', 'text', 'checklist']

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
    pack_id: packId,
    input_method: inputMethod,
    raw_input: rawInput,
    topics_extracted: topicsExtracted,
    topics_confirmed: topicsConfirmed
  } = req.body || {}

  if (typeof packId !== 'string' || !packId) {
    res.status(400).json({ error: 'pack_id is required' })
    return
  }
  if (!VALID_INPUT_METHODS.includes(inputMethod)) {
    res.status(400).json({ error: `input_method must be one of ${VALID_INPUT_METHODS.join(', ')}` })
    return
  }
  if (!Array.isArray(topicsConfirmed)) {
    res.status(400).json({ error: 'topics_confirmed must be an array' })
    return
  }

  let pack
  try {
    pack = getPack(packId)
  } catch {
    res.status(400).json({ error: `Unknown pack "${packId}"` })
    return
  }

  const validTopicIds = new Set(pack.units.flatMap((u) => u.topics.map((t) => t.id)))
  const confirmedValid = topicsConfirmed.filter((id) => validTopicIds.has(id))
  const extractedValid = Array.isArray(topicsExtracted)
    ? topicsExtracted.filter((id) => validTopicIds.has(id))
    : []

  const admin = getSupabaseAdmin()
  // Note: uses the authenticated user's id from the verified token, not
  // any user_id the client might send — a client-supplied id would let one
  // signed-in user write logs and unlock topics for another user's account.
  const { error: insertErr } = await admin.from('classroom_logs').insert({
    user_id: user.id,
    pack_id: packId,
    input_method: inputMethod,
    raw_input: rawInput ?? null,
    topics_extracted: extractedValid,
    topics_confirmed: confirmedValid,
    confirmed_at: new Date().toISOString()
  })

  if (insertErr) {
    res.status(500).json({ error: 'Failed to save classroom log' })
    return
  }

  try {
    await unlockTopics({ userId: user.id, packId, topicIds: confirmedValid, source: 'classroom_log' })
    await prioritizeTopics({ userId: user.id, packId, topicIds: confirmedValid })
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlock/prioritize topics', detail: err.message })
    return
  }

  res.status(200).json({
    success: true,
    unlocked_count: confirmedValid.length,
    prioritized_count: confirmedValid.length
  })
}
