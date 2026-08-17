#!/usr/bin/env node
// Bank management CLI.
//
// Usage:
//   node scripts/manage-bank.js status --pack ap-physics-1
//   node scripts/manage-bank.js fill --pack ap-physics-1 --topic kinematics.1d-motion --type mc
//   node scripts/manage-bank.js fill-all --pack ap-physics-1
//
// fill/fill-all call src/lib/bankFill.js's fillBank() directly, in-process
// — not the deployed /api/bank endpoint. That's deliberate: Vercel's
// serverless functions have a hard 60s timeout even on the fixed
// maxDuration setting, and some individual FRQ/conceptual generations
// occasionally run longer than that (confirmed live, not a concurrency
// effect). Running in this plain Node process has no such ceiling.

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getPack, getBankSizeTarget } from '../src/packs/loader.js'
import { checkBankHealth } from '../src/engine/bank-manager.js'
import { fillBank } from '../src/lib/bankFill.js'

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
  const result = await fillBank({ packId, topicId, questionType })
  console.log(`Generated ${result.generated} ${result.question_type} question(s) for ${result.topic_id}.`)
}

// A light retry for genuine transient failures (network blips, Claude API
// rate limits) — no longer specifically about escaping a Vercel timeout,
// since fillBank now runs directly in this process.
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fillWithRetry(packId, topicId, questionType) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fillBank({ packId, topicId, questionType })
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        console.log(`    retry ${attempt}/${MAX_ATTEMPTS - 1} for ${topicId} (${questionType}): ${err.message}`)
        await sleep(RETRY_DELAY_MS)
      }
    }
  }
  throw lastErr
}

// Safety cap on how many top-up batches a single fill-all run will fire at
// one topic/type, purely to bound the damage of a misconfigured huge
// bank_size_<type> (real money per batch) — not expected to ever bind for
// nmsqt-2026's bank_size_mc: 75 (8 batches of 10 gets there in 1).
const MAX_TOPUP_BATCHES_PER_ENTRY = 20

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
    `Filling ${needingFill.length} topic/type combination(s) for ${pack.name}. This makes at least that many Claude API calls (with automatic retries on transient timeouts, and more per entry for any type with a configured bank_size target) and can take a while — expected.\n`
  )

  let succeeded = 0
  let failed = 0
  for (const entry of needingFill) {
    // getBankSizeTarget returns undefined for any pack that doesn't set
    // bank_size_<type> — that's every pack except nmsqt-2026 today — which
    // preserves the exact original one-batch-per-trigger behavior rather
    // than silently topping every existing pack up to some new default.
    const target = getBankSizeTarget(pack, entry.question_type)

    if (target === undefined) {
      try {
        const result = await fillWithRetry(packId, entry.topic_id, entry.question_type)
        console.log(`  ok ${entry.topic_id} (${entry.question_type}): generated ${result.generated}`)
        succeeded++
      } catch (err) {
        console.error(`  FAILED ${entry.topic_id} (${entry.question_type}) after ${MAX_ATTEMPTS} attempts: ${err.message}`)
        failed++
      }
      continue
    }

    let totalInBank = entry.total_in_bank
    let batches = 0
    while (totalInBank < target && batches < MAX_TOPUP_BATCHES_PER_ENTRY) {
      batches++
      try {
        const result = await fillWithRetry(packId, entry.topic_id, entry.question_type)
        totalInBank += result.generated
        succeeded++
        console.log(`  ok ${entry.topic_id} (${entry.question_type}): generated ${result.generated}, bank now ${totalInBank}/${target}`)
      } catch (err) {
        console.error(`  FAILED ${entry.topic_id} (${entry.question_type}) after ${MAX_ATTEMPTS} attempts: ${err.message}`)
        failed++
        break
      }
    }
    if (totalInBank < target && batches >= MAX_TOPUP_BATCHES_PER_ENTRY) {
      console.error(`  STOPPED ${entry.topic_id} (${entry.question_type}) at ${totalInBank}/${target} — hit the ${MAX_TOPUP_BATCHES_PER_ENTRY}-batch safety cap`)
    }
  }

  console.log(`\nDone. ${succeeded} batch(es) succeeded, ${failed} batch(es) failed.`)
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
