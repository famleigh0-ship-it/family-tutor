#!/usr/bin/env node
// Pacing-calendar-based topic unlocking. Phase 10 added a real scheduled
// job (api/progress/index.js's daily-maintenance cron handler, which calls
// the same runPacingCalendarSweep/expireAllStaleQuizPrepEvents functions
// this script does) — this stays around for manual/on-demand runs.
//
// Run with: node scripts/run-pacing-calendar.js

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { runPacingCalendarSweep } from '../src/engine/unlock.js'
import { expireAllStaleQuizPrepEvents } from '../src/engine/session-orchestrator.js'

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

// Phase 10: the pacing-calendar unlock loop and the quiz-prep expiry sweep
// both moved into src/engine/ (runPacingCalendarSweep in unlock.js,
// expireAllStaleQuizPrepEvents in session-orchestrator.js) so the new
// api/progress/index.js daily-maintenance cron handler can call the exact
// same logic instead of duplicating it. This script is now a thin wrapper
// — same behavior and log output as before.
async function main() {
  const { enrollmentsProcessed, topicsUnlocked } = await runPacingCalendarSweep(admin)
  if (enrollmentsProcessed === 0) {
    console.log('No enrollments found in user_course_packs.')
  } else {
    console.log(`Processed ${enrollmentsProcessed} enrollment(s), unlocked ${topicsUnlocked} new topic(s) total.`)
  }

  const { expired } = await expireAllStaleQuizPrepEvents(admin)
  console.log(`Expired ${expired} quiz prep events`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
