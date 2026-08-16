#!/usr/bin/env node
// Database health sanity check (Phase 11) — not a real backup, just a
// quick signal that the tables that matter aren't empty. Run this
// periodically (or right before/after anything risky) to catch an empty
// table before it's a surprise.
//
// Usage: node scripts/backup-check.js

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

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

// Every table from migrations/001_initial_schema.sql plus parent_pins
// (migrations/002_parent_pins_and_rls.sql) — the full schema as of Phase 11.
const ALL_TABLES = [
  'users',
  'family_links',
  'user_course_packs',
  'mastery_records',
  'sessions',
  'question_bank',
  'student_question_history',
  'question_log',
  'classroom_logs',
  'topic_unlock_log',
  'quiz_prep_events',
  'streaks',
  'parent_pins'
]

// A zero count here right after real accounts exist and packs have been
// filled is a red flag worth investigating immediately, not just noting.
// The others are allowed to legitimately be zero (e.g. quiz_prep_events
// with no active quiz, classroom_logs before the first log of the day).
const CRITICAL_TABLES = ['users', 'mastery_records', 'question_bank']

async function main() {
  const timestamp = new Date().toISOString()
  console.log(`Database health check — ${timestamp}\n`)

  const counts = {}
  for (const table of ALL_TABLES) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true })
    if (error) {
      console.error(`  ERROR reading ${table}: ${error.message}`)
      counts[table] = null
      continue
    }
    counts[table] = count
  }

  const nameWidth = Math.max(...ALL_TABLES.map((t) => t.length)) + 2
  for (const table of ALL_TABLES) {
    const count = counts[table]
    const isCriticalEmpty = CRITICAL_TABLES.includes(table) && count === 0
    const flag = count === null ? ' ERROR' : isCriticalEmpty ? ' ⚠ CRITICAL TABLE IS EMPTY' : ''
    console.log(`  ${table.padEnd(nameWidth)} ${String(count ?? '?').padStart(6)}${flag}`)
  }

  const emptyCritical = CRITICAL_TABLES.filter((t) => counts[t] === 0)
  const errored = ALL_TABLES.filter((t) => counts[t] === null)

  console.log()
  if (emptyCritical.length > 0) {
    console.error(`⚠  ${emptyCritical.length} critical table(s) empty: ${emptyCritical.join(', ')}`)
  }
  if (errored.length > 0) {
    console.error(`⚠  ${errored.length} table(s) failed to read: ${errored.join(', ')}`)
  }
  if (emptyCritical.length === 0 && errored.length === 0) {
    console.log('✓ All critical tables have data. No errors.')
  }

  if (emptyCritical.length > 0 || errored.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
