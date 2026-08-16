#!/usr/bin/env node
// Reviews student-flagged question reports (Phase 11 enhancement — see
// api/bank/index.js's PATCH handler and FeedbackCard.tsx's "Report this
// question" button).
//
// Usage:
//   node scripts/check-question-reports.js               # list unreviewed
//   node scripts/check-question-reports.js --mark-reviewed <report-id>

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

async function markReviewed(reportId) {
  const { error } = await admin
    .from('question_reports')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('id', reportId)

  if (error) {
    console.error('Failed to mark reviewed:', error.message)
    process.exit(1)
  }
  console.log(`Marked report ${reportId} as reviewed.`)
}

async function listUnreviewed() {
  const { data: reports, error } = await admin
    .from('question_reports')
    .select('id, user_id, pack_id, topic_id, question_id, question_type, note, reported_at')
    .is('reviewed_at', null)
    .order('reported_at', { ascending: true })

  if (error) {
    console.error('Failed to load reports:', error.message)
    process.exit(1)
  }

  if (!reports || reports.length === 0) {
    console.log('UNREVIEWED_COUNT=0')
    console.log('No unreviewed question reports.')
    return
  }

  const userIds = [...new Set(reports.map((r) => r.user_id))]
  const questionIds = [...new Set(reports.map((r) => r.question_id).filter(Boolean))]

  const { data: users } = await admin.from('users').select('id, name').in('id', userIds)
  const nameById = new Map((users ?? []).map((u) => [u.id, u.name]))

  const { data: questions } = await admin
    .from('question_bank')
    .select('id, question_text, options, correct_answer')
    .in('id', questionIds)
  const questionById = new Map((questions ?? []).map((q) => [q.id, q]))

  console.log(`UNREVIEWED_COUNT=${reports.length}`)
  console.log(`\n${reports.length} unreviewed question report(s):\n`)

  for (const r of reports) {
    const q = questionById.get(r.question_id)
    console.log('─'.repeat(60))
    console.log(`report_id:   ${r.id}`)
    console.log(`reported_at: ${r.reported_at}`)
    console.log(`by:          ${nameById.get(r.user_id) ?? r.user_id}`)
    console.log(`pack/topic:  ${r.pack_id} / ${r.topic_id}`)
    console.log(`type:        ${r.question_type}`)
    if (r.note) console.log(`note:        ${r.note}`)
    if (q) {
      console.log(`question:    ${q.question_text}`)
      console.log(`options:     ${JSON.stringify(q.options)}`)
      console.log(`correct_answer: ${q.correct_answer}`)
    } else {
      console.log('question:    (question_bank row not found — may have been deleted)')
    }
  }
  console.log('─'.repeat(60))
  console.log(`\nTo mark one reviewed after fixing it:\n  node scripts/check-question-reports.js --mark-reviewed <report_id>`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args['mark-reviewed']) {
    await markReviewed(args['mark-reviewed'])
    return
  }

  await listUnreviewed()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
