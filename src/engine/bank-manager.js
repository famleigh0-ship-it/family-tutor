// Server-side only — reads Supabase with the service role key. Plain JS
// (not .ts, despite the Phase 6 spec naming it bank-manager.ts): this
// module is imported by session-orchestrator.js, which api/grading/*.js
// now import directly, so it inherits the same Vercel .ts-resolution
// limitation as everything else converted in this phase. See
// src/packs/loader.js for the original discovery.

import { createClient } from '@supabase/supabase-js'
import { getPack } from '../packs/loader.js'
import { postBankFill } from '../lib/triggerBankFill.js'

/** @typedef {{ topic_id: string, question_type: string, total_in_bank: number, unseen_by_user: number, needs_fill: boolean }} BankHealthEntry */

// "refill when < N remaining unseen for any user" per spec — the trigger
// is purely the per-user unseen count, checked independently for whoever
// is about to start a session.
const REFILL_BELOW = { mc: 8, conceptual: 5, frq: 3 }
const QUESTION_TYPES = ['mc', 'conceptual', 'frq']

/** @type {import('@supabase/supabase-js').SupabaseClient | undefined} */
let client

function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceRoleKey) {
      throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.')
    }

    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return client
}

/**
 * Checks every topic + question type in the pack against the fill
 * thresholds for one specific student.
 * @param {string} packId
 * @param {string} userId
 * @returns {Promise<BankHealthEntry[]>}
 */
export async function checkBankHealth(packId, userId) {
  const admin = getSupabaseAdmin()
  const pack = getPack(packId)

  const { data: bankRows, error: bankErr } = await admin
    .from('question_bank')
    .select('id, topic_id, question_type')
    .eq('pack_id', packId)
  if (bankErr) throw bankErr

  const questionIds = (bankRows ?? []).map((r) => r.id)

  let seenQuestionIds = new Set()
  if (questionIds.length > 0) {
    // A pack's full question_bank can run into the thousands of rows —
    // filtering student_question_history with .in('question_id', ids)
    // against that many ids builds a URL PostgREST rejects outright
    // ("Bad Request"), confirmed live once the bank passed ~1500
    // questions. Scoping via an embedded join on question_bank.pack_id
    // avoids ever needing an id list in the query at all.
    const { data: historyRows, error: histErr } = await admin
      .from('student_question_history')
      .select('question_id, question_bank!inner(pack_id)')
      .eq('user_id', userId)
      .eq('question_bank.pack_id', packId)
    if (histErr) throw histErr
    seenQuestionIds = new Set((historyRows ?? []).map((r) => r.question_id))
  }

  /** @type {BankHealthEntry[]} */
  const results = []
  for (const unit of pack.units) {
    for (const topic of unit.topics) {
      for (const questionType of QUESTION_TYPES) {
        const rowsForGroup = (bankRows ?? []).filter(
          (r) => r.topic_id === topic.id && r.question_type === questionType
        )
        const totalInBank = rowsForGroup.length
        const unseenByUser = rowsForGroup.filter((r) => !seenQuestionIds.has(r.id)).length

        results.push({
          topic_id: topic.id,
          question_type: questionType,
          total_in_bank: totalInBank,
          unseen_by_user: unseenByUser,
          needs_fill: unseenByUser < REFILL_BELOW[questionType]
        })
      }
    }
  }

  return results
}

/**
 * Fire-and-forget trigger — posts to /api/bank/fill and logs the result.
 * Never throws, so callers (e.g. startSession) can call this without
 * awaiting it and without risking an unhandled rejection.
 * @param {string} packId
 * @param {string} topicId
 * @param {string} questionType
 * @returns {Promise<void>}
 */
export async function triggerBankFill(packId, topicId, questionType) {
  try {
    const result = await postBankFill({ packId, topicId, questionType })
    console.log(`[bank-manager] filled ${topicId} (${questionType}): ${result.generated} generated`)
  } catch (err) {
    console.error(`[bank-manager] fill trigger failed for ${topicId} (${questionType})`, err)
  }
}
