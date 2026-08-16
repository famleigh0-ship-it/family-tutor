#!/usr/bin/env node
// Removes a student's enrollment in a course pack — the reverse of
// enroll-student.js. Deletes only the user_course_packs row, which is what
// Home.jsx and WelcomeFlow.tsx actually gate the course list on (via
// /api/progress?type=enrolled-packs), so the course stops showing up for
// the student immediately. Deliberately non-destructive: mastery_records,
// topic_unlock_log, sessions, and question_log for that pack are left
// alone, so re-enrolling later (enroll-student.js is safe to re-run,
// ignoreDuplicates on the mastery upsert) restores the course with its
// prior progress intact rather than starting over.
//
// Usage:
//   node scripts/unenroll-student.js --student-id x --pack-id ap-physics-1

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

  if (!studentId || !packId) {
    console.error('Usage: node scripts/unenroll-student.js --student-id x --pack-id x')
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

  // Validates the pack id exists, same as enroll-student.js, before
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
    console.error(`No user found with id ${studentId}.`)
    process.exit(1)
  }
  if (userRow.role !== 'student') {
    console.error(`User ${studentId} (${userRow.name}) has role "${userRow.role}", not "student".`)
    process.exit(1)
  }

  const { data: existing, error: existingErr } = await admin
    .from('user_course_packs')
    .select('pack_id')
    .eq('user_id', studentId)
    .eq('pack_id', packId)
    .maybeSingle()

  if (existingErr) {
    console.error('Failed to check existing enrollment:', existingErr.message)
    process.exit(1)
  }
  if (!existing) {
    console.log(`${userRow.name} is not enrolled in ${pack.name} (${packId}) — nothing to do.`)
    return
  }

  const { error: deleteErr } = await admin
    .from('user_course_packs')
    .delete()
    .eq('user_id', studentId)
    .eq('pack_id', packId)

  if (deleteErr) {
    console.error('Failed to remove enrollment:', deleteErr.message)
    process.exit(1)
  }

  console.log(
    `Unenrolled ${userRow.name} (${studentId}) from ${pack.name} (${packId}). Mastery history and past sessions were left intact — re-enrolling restores them.`
  )
}

main()
