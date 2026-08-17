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
import { startSession, recordQuestionResult, endSession } from '../src/engine/session-orchestrator.js'
import { getMasteryLabel, getCurrentDifficulty, updateDifficultyMastery } from '../src/engine/mastery.js'
import { detectSessionMode } from '../src/engine/session-mode.js'
import { selectTopics } from '../src/engine/topic-selector.js'

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

function daysFromNow(n) {
  return new Date(Date.now() + n * DAY_MS).toISOString()
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
    {
      topic_id: 'dynamics.newtons-3rd-law-force-pairs',
      unlocked_at: daysAgo(2),
      unlock_source: 'classroom_log',
      prioritized_until: daysFromNow(3)
    },
    {
      topic_id: 'dynamics.free-body-diagrams',
      unlocked_at: daysAgo(2),
      unlock_source: 'classroom_log',
      prioritized_until: daysFromNow(3)
    },
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

  // On a re-run days later, an already-existing classroom_log row's
  // prioritized_until from the earlier run may have lapsed — refresh it so
  // the "prioritized" demonstration stays meaningful regardless of when
  // this script is re-run.
  for (const u of unlocks) {
    if (!u.prioritized_until) continue
    const { error } = await admin
      .from('topic_unlock_log')
      .update({ prioritized_until: u.prioritized_until })
      .eq('user_id', userId)
      .eq('pack_id', PACK_ID)
      .eq('topic_id', u.topic_id)
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`[NMSQT test] FAILED — ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  console.log(`  ok ${label} (${JSON.stringify(actual)})`)
}

function assertTrue(condition, label) {
  if (!condition) throw new Error(`[NMSQT test] FAILED — ${label}`)
  console.log(`  ok ${label}`)
}

// A10: engine-level NMSQT checks using an inline mock CoursePack, not the
// real course-packs/nmsqt-2026/pack.json (Part B) — selectTopics and the
// mastery.js functions all take their pack/record data as plain
// parameters rather than resolving it through the loader's getPack(), so
// this exercises the real difficulty-escalation logic against real
// Supabase-shaped data without needing the pack registered anywhere.
// startSession/recordQuestionResult themselves DO call getPack()
// internally, so a true end-to-end DB session test has to wait until the
// pack exists (Part B) — this covers everything Part A's engine logic
// owns on its own.
function testNmsqtEngineLogic() {
  console.log('\n=== NMSQT engine logic (mock pack, no DB) ===')

  // --- detectSessionMode: NMSQT never onboarding/quiz-prep ---
  assertEqual(
    detectSessionMode({ sessionCount: 0, daysUntilExam: 100, examCrunchWeeks: 6, activeQuizPrepEvent: null, isNMSQT: true }),
    'adaptive',
    'NMSQT sessionCount=0 still adaptive, not onboarding'
  )
  assertEqual(
    detectSessionMode({ sessionCount: 50, daysUntilExam: 21, examCrunchWeeks: 6, activeQuizPrepEvent: null, isNMSQT: true }),
    'exam-crunch',
    'NMSQT daysUntilExam=21 is exam-crunch (3-week window)'
  )
  assertEqual(
    detectSessionMode({ sessionCount: 50, daysUntilExam: 22, examCrunchWeeks: 6, activeQuizPrepEvent: null, isNMSQT: true }),
    'adaptive',
    'NMSQT daysUntilExam=22 is adaptive (just outside 3-week window)'
  )
  // AP behavior (isNMSQT omitted) must be untouched.
  assertEqual(
    detectSessionMode({ sessionCount: 0, daysUntilExam: 100, examCrunchWeeks: 6, activeQuizPrepEvent: null }),
    'onboarding',
    'AP sessionCount=0 is still onboarding'
  )

  // --- getCurrentDifficulty / updateDifficultyMastery ---
  const freshRecord = {
    topic_id: 'mock.topic',
    pack_id: 'mock-nmsqt',
    mastery_score: 0,
    attempts: 0,
    correct: 0,
    frq_attempts: 0,
    frq_score_total: 0,
    last_seen: null,
    updated_at: new Date(),
    difficulty_1_mastery: 0,
    difficulty_2_mastery: 0,
    difficulty_3_mastery: 0,
    current_difficulty: 1
  }
  assertEqual(getCurrentDifficulty(freshRecord), 1, 'new student starts at difficulty 1')

  let record = freshRecord
  for (let i = 0; i < 5; i++) {
    record = updateDifficultyMastery(record, { correct: true, question_type: 'mc', time_spent_seconds: 20 }, 1)
  }
  assertTrue(record.difficulty_1_mastery >= 0.7, `difficulty_1_mastery reached ${record.difficulty_1_mastery.toFixed(3)} after 5 correct answers`)
  assertEqual(record.attempts, 5, 'overall attempts incremented alongside difficulty-specific tracking')
  assertEqual(getCurrentDifficulty(record), 2, 'current_difficulty escalates to 2 once difficulty_1_mastery >= 0.70')
  assertEqual(record.current_difficulty, 2, 'updateDifficultyMastery wrote the escalated current_difficulty onto the record')

  // --- selectTopics: served difficulty comes from getCurrentDifficulty, not a static value ---
  const mockPack = {
    id: 'mock-nmsqt',
    name: 'Mock NMSQT',
    school_year_start: '2026-08-11',
    exam_date: '2026-10-15',
    exam_crunch_weeks: 3,
    tutor_persona: 'mock',
    subject_context: 'mock',
    exam_type: 'nmsqt',
    session_duration_minutes: 15,
    question_types_allowed: ['mc'],
    difficulty_escalation: true,
    units: [
      {
        id: 'unit-a',
        name: 'Unit A',
        ap_exam_weight_min: 50,
        ap_exam_weight_max: 50,
        prerequisite_unit_ids: [],
        topics: [
          {
            id: 'unit-a.escalated-topic',
            name: 'Escalated Topic',
            type: 'conceptual',
            difficulty: 1, // static pack value — must NOT be what gets served
            prerequisite_topic_ids: [],
            input_mode: 'typed',
            prompt_hints: [],
            common_errors: []
          },
          {
            id: 'unit-a.fresh-topic',
            name: 'Fresh Topic',
            type: 'conceptual',
            difficulty: 1,
            prerequisite_topic_ids: [],
            input_mode: 'typed',
            prompt_hints: [],
            common_errors: []
          }
        ]
      }
    ],
    pacing_calendar: [],
    common_misconceptions: [],
    frq_rubric: { general_guidance: 'mock', point_allocation_pattern: 'mock', common_reasoning_gaps: [] }
  }

  const plan = selectTopics({
    pack: mockPack,
    masteryRecords: [{ ...record, topic_id: 'unit-a.escalated-topic' }],
    unlockedTopicIds: ['unit-a.escalated-topic', 'unit-a.fresh-topic'],
    prioritizedTopicIds: [],
    mode: 'adaptive',
    quizPrepTopicIds: [],
    recentTopicIds: [],
    targetDurationMinutes: 15
  })

  const escalatedTopic = plan.topics.find((t) => t.id === 'unit-a.escalated-topic')
  const freshTopic = plan.topics.find((t) => t.id === 'unit-a.fresh-topic')
  assertTrue(!!escalatedTopic, 'escalated topic was selected')
  assertTrue(!!freshTopic, 'fresh topic was selected')
  assertEqual(escalatedTopic.difficulty, 2, 'served difficulty for the escalated topic is computed (2), not the static pack value (1)')
  assertEqual(freshTopic.difficulty, 1, 'served difficulty for a never-attempted topic stays at 1')
  assertEqual(JSON.stringify(plan.allowed_question_types), JSON.stringify(['mc']), 'plan surfaces pack.question_types_allowed')

  console.log('\nAll NMSQT engine logic checks passed.')
}

async function main() {
  testNmsqtEngineLogic()

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
