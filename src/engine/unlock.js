// Server-side only. Reads/writes Supabase with the service role key — never
// import from src/pages or src/components.
//
// Plain JS (not .ts) so this loads identically under Vite, plain Node
// script execution, AND Vercel's serverless function bundler — which
// cannot resolve a directly-imported .ts file at runtime (confirmed via
// ERR_MODULE_NOT_FOUND when api/classroom/confirm-log.js imported the old
// unlock.ts). See src/packs/loader.js for the same fix, applied first.

import { createClient } from '@supabase/supabase-js'

const PRIORITIZED_DAYS = 5
const MS_PER_DAY = 86_400_000

/** @type {import('@supabase/supabase-js').SupabaseClient | undefined} */
let client

function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceRoleKey) {
      throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.')
    }

    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return client
}

/**
 * Idempotent: only inserts topic_unlock_log rows for topics that don't
 * already have one for this user + pack.
 * @param {{ userId: string, packId: string, topicIds: string[], source: import('./types').UnlockSource }} params
 * @returns {Promise<void>}
 */
export async function unlockTopics(params) {
  const { userId, packId, topicIds, source } = params
  if (topicIds.length === 0) return

  const admin = getSupabaseAdmin()

  const { data: existing, error: existingErr } = await admin
    .from('topic_unlock_log')
    .select('topic_id')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .in('topic_id', topicIds)

  if (existingErr) throw existingErr

  const alreadyUnlocked = new Set((existing ?? []).map((r) => r.topic_id))
  const toInsert = topicIds.filter((id) => !alreadyUnlocked.has(id))
  if (toInsert.length === 0) return

  const { error: insertErr } = await admin.from('topic_unlock_log').insert(
    toInsert.map((topicId) => ({
      user_id: userId,
      pack_id: packId,
      topic_id: topicId,
      unlock_source: source
    }))
  )

  if (insertErr) throw insertErr
}

/**
 * Sets prioritized_until = now + `days` (default 5) on existing
 * topic_unlock_log rows. Call after unlockTopics so the rows are
 * guaranteed to exist. Quiz prep's post-quiz "rough" result
 * (api/quiz-prep/index.js) passes days: 7 to re-prioritize weak topics
 * longer than a normal classroom-log boost.
 * @param {{ userId: string, packId: string, topicIds: string[], days?: number }} params
 * @returns {Promise<void>}
 */
export async function prioritizeTopics(params) {
  const { userId, packId, topicIds, days = PRIORITIZED_DAYS } = params
  if (topicIds.length === 0) return

  const admin = getSupabaseAdmin()
  const prioritizedUntil = new Date(Date.now() + days * MS_PER_DAY).toISOString()

  const { error } = await admin
    .from('topic_unlock_log')
    .update({ prioritized_until: prioritizedUntil })
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .in('topic_id', topicIds)

  if (error) throw error
}

/**
 * @param {string} userId
 * @param {string} packId
 * @returns {Promise<string[]>}
 */
export async function getPrioritizedTopicIds(userId, packId) {
  const admin = getSupabaseAdmin()
  const nowIso = new Date().toISOString()

  const { data, error } = await admin
    .from('topic_unlock_log')
    .select('topic_id')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .gt('prioritized_until', nowIso)

  if (error) throw error

  return Array.from(new Set((data ?? []).map((r) => r.topic_id)))
}
