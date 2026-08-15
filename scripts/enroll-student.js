#!/usr/bin/env node
// Enrolls a student in a course pack: creates the user_course_packs row,
// pre-populates mastery_records at 0 for every topic in the pack (so the
// heatmap shows all topics immediately instead of only ones the student
// has attempted), and ensures a streaks row exists (create-user.js already
// creates one at account creation — this is a safety net for accounts
// created before that, or created some other way).
//
// Usage:
//   node scripts/enroll-student.js --student-id x --pack-id ap-physics-1 --exam-date 2027-05-10

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getPack } from '../src/packs/loader.js'

loadEnv({ path: '.env.local' })

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1]
      i++
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const studentId = args['student-id']
  const packId = args['pack-id']
  const examDate = args['exam-date']

  if (!studentId || !packId) {
    console.error('Usage: node scripts/enroll-student.js --student-id x --pack-id x [--exam-date YYYY-MM-DD]')
    process.exit(1)
  }

  const url = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // Validates the pack exists and gives us the full topic list, before
  // touching the database at all.
  const pack = getPack(packId)

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('id, role, name')
    .eq('id', studentId)
    .maybeSingle()

  if (userErr) {
    console.error('Failed to look up student:', userErr.message)
    process.exit(1)
  }
  if (!userRow) {
    console.error(`No user found with id ${studentId}. Run create-user.js first.`)
    process.exit(1)
  }
  if (userRow.role !== 'student') {
    console.error(`User ${studentId} (${userRow.name}) has role "${userRow.role}", not "student".`)
    process.exit(1)
  }

  // 1. user_course_packs — upsert so re-running (e.g. to change exam_date)
  // doesn't fail on the existing (user_id, pack_id) primary key.
  const { error: enrollErr } = await admin.from('user_course_packs').upsert(
    {
      user_id: studentId,
      pack_id: packId,
      exam_date: examDate ?? pack.exam_date
    },
    { onConflict: 'user_id,pack_id' }
  )

  if (enrollErr) {
    console.error('Failed to create user_course_packs row:', enrollErr.message)
    process.exit(1)
  }

  // 2. mastery_records — one zeroed row per topic, so the heatmap shows
  // every topic (locked or not) from the student's very first login rather
  // than only ones they've attempted. onConflict skips topics that already
  // have real attempt data (re-running this must never zero out progress).
  const topics = pack.units.flatMap((u) => u.topics)
  const masteryRows = topics.map((t) => ({
    user_id: studentId,
    pack_id: packId,
    topic_id: t.id,
    mastery_score: 0,
    attempts: 0,
    correct: 0,
    frq_attempts: 0,
    frq_score_total: 0
  }))

  const { error: masteryErr } = await admin
    .from('mastery_records')
    .upsert(masteryRows, { onConflict: 'user_id,pack_id,topic_id', ignoreDuplicates: true })

  if (masteryErr) {
    console.error('Failed to create mastery_records rows:', masteryErr.message)
    process.exit(1)
  }

  // 3. streaks — create-user.js already inserts this at account creation;
  // this is just a safety net for an account that predates that, or was
  // created some other way.
  const { data: existingStreak, error: streakLookupErr } = await admin
    .from('streaks')
    .select('user_id')
    .eq('user_id', studentId)
    .maybeSingle()

  if (streakLookupErr) {
    console.error('Failed to check streaks row:', streakLookupErr.message)
    process.exit(1)
  }

  if (!existingStreak) {
    const { error: streakErr } = await admin.from('streaks').insert({ user_id: studentId })
    if (streakErr) {
      console.error('Failed to create streaks row:', streakErr.message)
      process.exit(1)
    }
  }

  console.log(
    `Enrolled ${userRow.name} (${studentId}) in ${pack.name} (${packId}) — exam_date ${examDate ?? pack.exam_date}, ${masteryRows.length} topics pre-populated.`
  )
}

main()
