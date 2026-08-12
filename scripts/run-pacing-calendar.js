#!/usr/bin/env node
// Pacing-calendar-based topic unlocking. Manual for now — will become a
// scheduled job in a later phase.
//
// Run with: node scripts/run-pacing-calendar.js

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getPack } from '../src/packs/loader.ts'
import { unlockTopics } from '../src/engine/unlock.ts'

loadEnv({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

function currentWeekNumber(schoolYearStart, today) {
  const start = new Date(schoolYearStart)
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

// Only the raw pacing_calendar entries — deliberately not the loader's
// getUnlockedTopics(), which also unlocks BC-only topics via prerequisite
// units. This job unlocks strictly what the AB calendar schedules.
function topicIdsThroughWeek(pack, currentWeek) {
  const ids = new Set()
  for (const week of pack.pacing_calendar) {
    if (week.week <= currentWeek) {
      for (const id of week.topic_ids) ids.add(id)
    }
  }
  return Array.from(ids)
}

async function main() {
  const { data: enrollments, error } = await admin.from('user_course_packs').select('user_id, pack_id')
  if (error) throw error

  if (!enrollments || enrollments.length === 0) {
    console.log('No enrollments found in user_course_packs.')
    return
  }

  const today = new Date()

  for (const enrollment of enrollments) {
    let pack
    try {
      pack = getPack(enrollment.pack_id)
    } catch {
      console.warn(`Unknown pack "${enrollment.pack_id}" for user ${enrollment.user_id}, skipping.`)
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
    }

    console.log(
      `${enrollment.user_id} / ${enrollment.pack_id}: week ${currentWeek}, unlocked ${newTopicIds.length} new topic(s) (${scheduledTopicIds.length} scheduled total)`
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
