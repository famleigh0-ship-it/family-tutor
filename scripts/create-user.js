#!/usr/bin/env node
// Admin-only account provisioning. Creates the Supabase Auth user plus the
// matching users/streaks (and, for students, family_links) rows.
//
// Usage:
//   node scripts/create-user.js --email x --password x --name x --role student --parent-id x
//   node scripts/create-user.js --email x --password x --name x --role parent

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

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
  const { email, password, name, role } = args
  const parentId = args['parent-id']

  if (!email || !password || !name || !role) {
    console.error(
      'Usage: node scripts/create-user.js --email x --password x --name x --role student|parent [--parent-id x]'
    )
    process.exit(1)
  }

  if (role !== 'student' && role !== 'parent') {
    console.error('--role must be "student" or "parent"')
    process.exit(1)
  }

  if (role === 'student' && !parentId) {
    console.error('--parent-id is required when --role is "student"')
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

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })

  if (createErr) {
    console.error('Failed to create auth user:', createErr.message)
    process.exit(1)
  }

  const userId = created.user.id

  const { error: userRowErr } = await admin.from('users').insert({
    id: userId,
    email,
    role,
    name
  })

  if (userRowErr) {
    console.error(
      'Failed to create users row (auth user was already created — clean it up manually in Supabase if you retry):',
      userRowErr.message
    )
    process.exit(1)
  }

  const { error: streakErr } = await admin.from('streaks').insert({ user_id: userId })

  if (streakErr) {
    console.error('Failed to create streaks row:', streakErr.message)
    process.exit(1)
  }

  if (role === 'student') {
    const { error: linkErr } = await admin.from('family_links').insert({
      parent_id: parentId,
      student_id: userId
    })

    if (linkErr) {
      console.error('Failed to create family_links row:', linkErr.message)
      process.exit(1)
    }
  }

  console.log(`Created ${role} account for ${email} (id: ${userId})`)
}

main()
