// Server-side only. Reads/writes Supabase with the service role key — never
// import from src/pages or src/components.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { UnlockSource } from './types'

const PRIORITIZED_DAYS = 5
const MS_PER_DAY = 86_400_000

let client: SupabaseClient | undefined

function getSupabaseAdmin(): SupabaseClient {
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

// Idempotent: only inserts topic_unlock_log rows for topics that don't
// already have one for this user + pack.
export async function unlockTopics(params: {
  userId: string
  packId: string
  topicIds: string[]
  source: UnlockSource
}): Promise<void> {
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

  const alreadyUnlocked = new Set((existing ?? []).map((r) => r.topic_id as string))
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

// Sets prioritized_until = now + 5 days on existing topic_unlock_log rows.
// Call after unlockTopics so the rows are guaranteed to exist.
export async function prioritizeTopics(params: {
  userId: string
  packId: string
  topicIds: string[]
}): Promise<void> {
  const { userId, packId, topicIds } = params
  if (topicIds.length === 0) return

  const admin = getSupabaseAdmin()
  const prioritizedUntil = new Date(Date.now() + PRIORITIZED_DAYS * MS_PER_DAY).toISOString()

  const { error } = await admin
    .from('topic_unlock_log')
    .update({ prioritized_until: prioritizedUntil })
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .in('topic_id', topicIds)

  if (error) throw error
}

export async function getPrioritizedTopicIds(userId: string, packId: string): Promise<string[]> {
  const admin = getSupabaseAdmin()
  const nowIso = new Date().toISOString()

  const { data, error } = await admin
    .from('topic_unlock_log')
    .select('topic_id')
    .eq('user_id', userId)
    .eq('pack_id', packId)
    .gt('prioritized_until', nowIso)

  if (error) throw error

  return Array.from(new Set((data ?? []).map((r) => r.topic_id as string)))
}
