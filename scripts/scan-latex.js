#!/usr/bin/env node
// Scans question_bank for rows that still contain raw LaTeX commands
// instead of the Unicode math symbols bankFill.js's prompt asks for.
// Read-only — reports only, doesn't touch anything. See purge-latex.js
// to actually remove and refill the rows this finds.
//
// Usage: node scripts/scan-latex.js

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'

loadEnv({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

// A literal backslash followed by a letter is never legitimate outside of
// LaTeX commands in this content (physics/calc question text) — matches
// \lim, \frac, \sqrt, \to, \Rightarrow, \pm, \infty, \cdot, \Delta, etc.
export const LATEX_PATTERN = /\\[a-zA-Z]+/

export function textFields(row) {
  const fields = [row.question_text, row.rubric, row.explanation, row.correct_answer]
  if (Array.isArray(row.options)) {
    for (const opt of row.options) {
      if (opt && typeof opt === 'object') fields.push(opt.text, opt.distractor_note)
    }
  }
  if (Array.isArray(row.parts)) {
    for (const part of row.parts) {
      if (part && typeof part === 'object') fields.push(part.prompt)
    }
  }
  return fields.filter((f) => typeof f === 'string')
}

export async function findLatexRows(admin) {
  const { data: rows, error } = await admin
    .from('question_bank')
    .select('id, pack_id, topic_id, question_type, question_text, rubric, explanation, correct_answer, options, parts')
  if (error) throw error
  return { all: rows, bad: rows.filter((row) => textFields(row).some((f) => LATEX_PATTERN.test(f))) }
}

async function main() {
  const { all, bad } = await findLatexRows(admin)

  console.log(`Scanned ${all.length} questions across all packs.\n`)
  if (bad.length === 0) {
    console.log('No raw LaTeX found.')
    return
  }

  console.log(`${bad.length} question(s) contain raw LaTeX:\n`)
  const byPackTopic = new Map()
  for (const row of bad) {
    const key = `${row.pack_id} / ${row.topic_id} / ${row.question_type}`
    byPackTopic.set(key, (byPackTopic.get(key) ?? 0) + 1)
  }
  for (const [key, count] of [...byPackTopic.entries()].sort()) {
    console.log(`  ${count.toString().padStart(3)}  ${key}`)
  }

  console.log('\nSample question_text values:')
  for (const row of bad.slice(0, 5)) {
    console.log(`  [${row.pack_id}/${row.topic_id}] ${row.question_text?.slice(0, 100)}`)
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
