#!/usr/bin/env node
// Bank management CLI.
//
// Usage:
//   node scripts/manage-bank.js status --pack ap-physics-1
//   node scripts/manage-bank.js fill --pack ap-physics-1 --topic kinematics.1d-motion --type mc
//   node scripts/manage-bank.js fill-all --pack ap-physics-1
//
// fill/fill-all hit the deployed API (APP_BASE_URL/api/bank/fill), same as
// scripts/run-pacing-calendar.js and the Phase 5 classroom-log routes —
// /api/* only runs under Vercel, not plain `npm run dev`.

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getPack } from '../src/packs/loader.js'
import { checkBankHealth } from '../src/engine/bank-manager.js'
import { postBankFill } from '../src/lib/triggerBankFill.js'

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

// checkBankHealth's "unseen_by_user" is inherently per-student — for a
// bank-wide status report with no specific student in mind, this reuses
// the same dedicated test account scripts/test-engine.js already
// maintains, so `status`/`fill-all` share one well-known reference point.
const STATUS_USER_EMAIL = 'engine-test@family-tutor.local'

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      options[rest[i].slice(2)] = rest[i + 1]
      i++
    }
  }
  return { command, options }
}

async function getStatusUserId() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  const existing = data.users.find((u) => u.email === STATUS_USER_EMAIL)
  if (existing) return existing.id
  throw new Error(
    `Status reporting uses the ${STATUS_USER_EMAIL} test account (unseen-question counts are shown relative to it). Run "node scripts/test-engine.js" once first to create it.`
  )
}

async function cmdStatus(options) {
  const packId = options.pack
  if (!packId) {
    console.error('Usage: manage-bank.js status --pack <pack-id>')
    process.exit(1)
  }
  const pack = getPack(packId)
  const userId = await getStatusUserId()
  const health = await checkBankHealth(packId, userId)

  console.log(`\nBank health for ${pack.name} (unseen counts relative to ${STATUS_USER_EMAIL}):\n`)
  console.log('topic_id'.padEnd(48), 'type'.padEnd(12), 'total'.padEnd(7), 'unseen'.padEnd(8), 'needs_fill')
  for (const entry of health) {
    console.log(
      entry.topic_id.padEnd(48),
      entry.question_type.padEnd(12),
      String(entry.total_in_bank).padEnd(7),
      String(entry.unseen_by_user).padEnd(8),
      entry.needs_fill ? 'YES' : ''
    )
  }

  const needingFill = health.filter((h) => h.needs_fill)
  console.log(`\n${needingFill.length} of ${health.length} topic/type combinations need a fill.`)
}

async function cmdFill(options) {
  const { pack: packId, topic: topicId, type: questionType } = options
  if (!packId || !topicId || !questionType) {
    console.error('Usage: manage-bank.js fill --pack <pack-id> --topic <topic-id> --type <mc|conceptual|frq>')
    process.exit(1)
  }
  const result = await postBankFill({ packId, topicId, questionType })
  console.log(`Generated ${result.generated} ${result.question_type} question(s) for ${result.topic_id}.`)
}

async function cmdFillAll(options) {
  const packId = options.pack
  if (!packId) {
    console.error('Usage: manage-bank.js fill-all --pack <pack-id>')
    process.exit(1)
  }
  const pack = getPack(packId)
  const userId = await getStatusUserId()
  const health = await checkBankHealth(packId, userId)
  const needingFill = health.filter((h) => h.needs_fill)

  console.log(
    `Filling ${needingFill.length} topic/type combination(s) for ${pack.name}. This makes that many Claude API calls and can take several minutes — expected.\n`
  )

  let succeeded = 0
  let failed = 0
  for (const entry of needingFill) {
    try {
      const result = await postBankFill({ packId, topicId: entry.topic_id, questionType: entry.question_type })
      console.log(`  ok ${entry.topic_id} (${entry.question_type}): generated ${result.generated}`)
      succeeded++
    } catch (err) {
      console.error(`  FAILED ${entry.topic_id} (${entry.question_type}): ${err.message}`)
      failed++
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`)
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))

  if (command === 'status') return cmdStatus(options)
  if (command === 'fill') return cmdFill(options)
  if (command === 'fill-all') return cmdFillAll(options)

  console.error('Usage: manage-bank.js <status|fill|fill-all> [options]')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
