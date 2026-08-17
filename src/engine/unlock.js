// Server-side only. Reads/writes Supabase with the service role key — never
// import from src/pages or src/components.
//
// Plain JS (not .ts) so this loads identically under Vite, plain Node
// script execution, AND Vercel's serverless function bundler — which
// cannot resolve a directly-imported .ts file at runtime (confirmed via
// ERR_MODULE_NOT_FOUND when api/classroom/confirm-log.js imported the old
// unlock.ts). See src/packs/loader.js for the same fix, applied first.

import { createClient } from '@supabase/supabase-js'
import { getPack, isNMSQT } from '../packs/loader.js'

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

function currentWeekNumber(schoolYearStart, today) {
  const start = new Date(schoolYearStart)
  const diffDays = Math.floor((today.getTime() - start.getTime()) / MS_PER_DAY)
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

// Only the raw pacing_calendar entries — deliberately not the loader's
// getUnlockedTopics(), which also unlocks BC-only topics via prerequisite
// units. This unlocks strictly what the AB calendar schedules.
function topicIdsThroughWeek(pack, currentWeek) {
  const ids = new Set()
  for (const week of pack.pacing_calendar) {
    if (week.week <= currentWeek) {
      for (const id of week.topic_ids) ids.add(id)
    }
  }
  return Array.from(ids)
}

/**
 * Walks every user_course_packs enrollment and unlocks any pacing-calendar
 * topics scheduled for a week that's already started. Phase 10: extracted
 * from scripts/run-pacing-calendar.js's main() so it can be shared with
 * the api/progress/index.js daily-maintenance cron handler — both already
 * have their own already-constructed admin client, so this takes one as a
 * parameter rather than building its own.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @returns {Promise<{ enrollmentsProcessed: number, topicsUnlocked: number }>}
 */
export async function runPacingCalendarSweep(admin) {
  const { data: enrollments, error } = await admin.from('user_course_packs').select('user_id, pack_id')
  if (error) throw error

  if (!enrollments || enrollments.length === 0) {
    return { enrollmentsProcessed: 0, topicsUnlocked: 0 }
  }

  const today = new Date()
  let topicsUnlocked = 0

  for (const enrollment of enrollments) {
    let pack
    try {
      pack = getPack(enrollment.pack_id)
    } catch {
      continue // stale/unknown pack id — skip rather than fail the sweep
    }

    // NMSQT packs have no pacing_calendar at all (every topic unlocks from
    // day one — see session-orchestrator.js's startSession) — the sweep
    // below would already no-op for one (topicIdsThroughWeek finds nothing
    // to unlock against an empty pacing_calendar), but logging it
    // explicitly makes that "nothing to do here" state visible rather than
    // silent, matching every other skip reason this sweep logs.
    if (isNMSQT(pack)) {
      console.log(`[pacing-calendar] ${pack.id} skipped (no pacing calendar)`)
      continue
    }

    const currentWeek = currentWeekNumber(pack.school_year_start, today)
    const scheduledTopicIds = topicIdsThroughWeek(pack, currentWeek)

    const { data: existing, error: existingErr } = await admin
      .from('topic_unlock_log')
      .select('topic_id')
      .eq('user_id', enrollment.user_id)
      .eq('pack_id', enrollment.pack_id)
      .in('topic_id', scheduledTopicIds)
    if (existingErr) throw existingErr

    const alreadyUnlocked = new Set((existing ?? []).map((r) => r.topic_id))
    const newTopicIds = scheduledTopicIds.filter((id) => !alreadyUnlocked.has(id))

    if (newTopicIds.length > 0) {
      await unlockTopics({
        userId: enrollment.user_id,
        packId: enrollment.pack_id,
        topicIds: newTopicIds,
        source: 'pacing_calendar'
      })
      topicsUnlocked += newTopicIds.length
    }
  }

  return { enrollmentsProcessed: enrollments.length, topicsUnlocked }
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
