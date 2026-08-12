#!/usr/bin/env node
// Mock session runner for the adaptive engine — no Claude API calls, no
// real question bank. Simulates a test student progressing through
// AP Physics 1 sessions so the engine can be exercised end to end against
// real Supabase tables before real question content exists.
//
// Run with: node scripts/test-engine.js

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { startSession, recordQuestionResult, endSession } from '../src/engine/session-orchestrator.ts'
import { getMasteryLabel } from '../src/engine/mastery.ts'

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

const PACK_ID = 'ap-physics-1'
const TEST_EMAIL = 'engine-test@family-tutor.local'
const SESSION_COUNT = 4
const DAY_MS = 86_400_000

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString()
}

async function getOrCreateTestUser() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error

  let user = data.users.find((u) => u.email === TEST_EMAIL)
  if (user) return user

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: randomUUID(),
    email_confirm: true
  })
  if (createErr) throw createErr
  user = created.user

  const { error: userRowErr } = await admin
    .from('users')
    .insert({ id: user.id, email: TEST_EMAIL, role: 'student', name: 'Engine Test Student' })
  if (userRowErr) throw userRowErr

  const { error: streakErr } = await admin.from('streaks').insert({ user_id: user.id })
  if (streakErr) throw streakErr

  return user
}

// Idempotent: safe to run this script repeatedly without piling up
// duplicate unlock-log rows or resetting mastery in a surprising way.
async function seedMockData(userId) {
  const unlocks = [
    { topic_id: 'kinematics.1d-motion', unlocked_at: daysAgo(60), unlock_source: 'pacing_calendar' },
    { topic_id: 'kinematics.vectors-2d-motion', unlocked_at: daysAgo(55), unlock_source: 'pacing_calendar' },
    { topic_id: 'kinematics.projectile-motion', unlocked_at: daysAgo(50), unlock_source: 'pacing_calendar' },
    { topic_id: 'kinematics.relative-motion', unlocked_at: daysAgo(45), unlock_source: 'pacing_calendar' },
    { topic_id: 'dynamics.newtons-1st-2nd-law', unlocked_at: daysAgo(40), unlock_source: 'pacing_calendar' },
    { topic_id: 'dynamics.newtons-3rd-law-force-pairs', unlocked_at: daysAgo(2), unlock_source: 'classroom_log' },
    { topic_id: 'dynamics.free-body-diagrams', unlocked_at: daysAgo(2), unlock_source: 'classroom_log' },
    { topic_id: 'dynamics.friction-normal-force', unlocked_at: daysAgo(35), unlock_source: 'pacing_calendar' }
    // Everything else in the pack stays locked — never appears in
    // topic_unlock_log for this user.
  ]

  const { data: existingUnlocks, error: existingErr } = await admin
    .from('topic_unlock_log')
    .select('topic_id')
    .eq('user_id', userId)
    .eq('pack_id', PACK_ID)
  if (existingErr) throw existingErr

  const alreadyUnlocked = new Set((existingUnlocks ?? []).map((r) => r.topic_id))
  const toInsert = unlocks.filter((u) => !alreadyUnlocked.has(u.topic_id))

  if (toInsert.length > 0) {
    const { error } = await admin
      .from('topic_unlock_log')
      .insert(toInsert.map((u) => ({ user_id: userId, pack_id: PACK_ID, ...u })))
    if (error) throw error
  }

  // Deliberate mix: mastered, practicing-but-stale (review candidate),
  // critical (<0.4), decayed-looking, and mid-range. Three of the eight
  // unlocked topics get no row at all, to exercise the default-record path.
  const masteryRows = [
    { topic_id: 'kinematics.1d-motion', mastery_score: 0.95, last_seen: daysAgo(3) },
    { topic_id: 'kinematics.vectors-2d-motion', mastery_score: 0.65, last_seen: daysAgo(10) },
    { topic_id: 'kinematics.projectile-motion', mastery_score: 0.25, last_seen: daysAgo(2) },
    { topic_id: 'kinematics.relative-motion', mastery_score: 0.75, last_seen: daysAgo(20) },
    { topic_id: 'dynamics.newtons-1st-2nd-law', mastery_score: 0.5, last_seen: daysAgo(1) }
  ]

  for (const row of masteryRows) {
    const { error } = await admin.from('mastery_records').upsert(
      {
        user_id: userId,
        pack_id: PACK_ID,
        topic_id: row.topic_id,
        mastery_score: row.mastery_score,
        attempts: 4,
        correct: 3,
        frq_attempts: 0,
        frq_score_total: 0,
        last_seen: row.last_seen,
        updated_at: row.last_seen
      },
      { onConflict: 'user_id,pack_id,topic_id' }
    )
    if (error) throw error
  }
}

function buildMockResults(plan) {
  if (plan.topics.length === 0) return []

  const pattern = [
    { correct: true, isFrq: false },
    { correct: false, isFrq: true, frqScore: 1 },
    { correct: true, isFrq: true, frqScore: 4 },
    { correct: true, isFrq: false },
    { correct: false, isFrq: false }
  ]

  return pattern.map((p, i) => {
    const topic = plan.topics[i % plan.topics.length]
    return {
      topic_id: topic.id,
      question_type: p.isFrq ? 'frq' : topic.type === 'conceptual' ? 'conceptual' : 'mc',
      correct: p.correct,
      frq_score: p.isFrq ? p.frqScore : undefined,
      time_spent_seconds: p.isFrq ? 300 : 60
    }
  })
}

function printPlan(plan, sessionNumber) {
  console.log(`\n=== Session ${sessionNumber} — mode: ${plan.mode} ===`)
  console.log(`Target: ${plan.target_question_count} questions, ~${plan.target_duration_minutes} min`)
  console.log('Topics:')
  for (const t of plan.topics) {
    console.log(
      `  - ${t.name} (${t.id}) | mastery ${t.mastery_score.toFixed(2)} [${getMasteryLabel(t.mastery_score)}] | ${t.unlock_state} | priority ${t.priority_score.toFixed(2)}`
    )
  }
  if (plan.notes.length > 0) {
    console.log('Notes:')
    for (const note of plan.notes) console.log(`  - ${note}`)
  }
}

async function main() {
  console.log(`Using test student: ${TEST_EMAIL}`)
  const user = await getOrCreateTestUser()
  console.log(`Test user id: ${user.id}`)

  await seedMockData(user.id)
  console.log('Seeded mock unlock/mastery data (idempotent — safe to re-run).')

  const touchedTopicIds = new Set()

  for (let i = 1; i <= SESSION_COUNT; i++) {
    const plan = await startSession({ userId: user.id, packId: PACK_ID, targetDurationMinutes: 20 })
    printPlan(plan, i)

    const results = buildMockResults(plan)
    for (const result of results) {
      touchedTopicIds.add(result.topic_id)
      await recordQuestionResult({ sessionId: plan.sessionId, userId: user.id, result })
    }

    await endSession({ sessionId: plan.sessionId, userId: user.id })
  }

  console.log('\n=== Final mastery scores (topics touched by simulated questions) ===')
  const { data: finalRecords, error: finalErr } = await admin
    .from('mastery_records')
    .select('topic_id, mastery_score, attempts, correct')
    .eq('user_id', user.id)
    .eq('pack_id', PACK_ID)
    .in('topic_id', Array.from(touchedTopicIds))
  if (finalErr) throw finalErr

  for (const r of finalRecords ?? []) {
    console.log(
      `  - ${r.topic_id}: ${r.mastery_score.toFixed(3)} [${getMasteryLabel(r.mastery_score)}] (${r.correct}/${r.attempts} correct)`
    )
  }

  console.log('\n=== Streak state ===')
  const { data: streak, error: streakErr } = await admin
    .from('streaks')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (streakErr) throw streakErr

  console.log(streak)
  console.log(
    '(All sessions above ran "today", so current_streak stays at 1 — day-over-day increments need real elapsed days to demonstrate.)'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
