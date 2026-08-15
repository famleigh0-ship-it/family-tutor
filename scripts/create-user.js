#!/usr/bin/env node
// Admin-only account provisioning. Creates the Supabase Auth user plus the
// matching users/streaks (and, for students, family_links) rows.
//
// Usage:
//   node scripts/create-user.js --email x --password x --name x --role student --parent-id x
//   node scripts/create-user.js --email x --password x --name x --role parent
//   node scripts/create-user.js --verify --email x   (read-only lookup, no other flags needed)

import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

loadEnv({ path: '.env.local' })

// --verify is a boolean flag (no value of its own) — pulled out before the
// generic --key value parser below, which otherwise assumes every flag is
// followed by its value and would swallow the next real flag as --verify's
// "value".
function parseArgs(argv) {
  const verify = argv.includes('--verify')
  const rest = argv.filter((a) => a !== '--verify')
  const args = { verify }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      args[rest[i].slice(2)] = rest[i + 1]
      i++
    }
  }
  return args
}

async function verifyUser(admin, email) {
  const { data: authData, error: authErr } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (authErr) {
    console.error('Failed to look up auth users:', authErr.message)
    process.exit(1)
  }
  const authUser = authData.users.find((u) => u.email === email)
  if (!authUser) {
    console.log(`No auth account found for ${email}.`)
    return
  }

  const { data: userRow, error: userErr } = await admin.from('users').select('*').eq('id', authUser.id).maybeSingle()
  if (userErr) {
    console.error('Failed to look up users row:', userErr.message)
    process.exit(1)
  }
  if (!userRow) {
    console.log(`Auth account exists for ${email} (id: ${authUser.id}) but has no matching users row — incomplete setup.`)
    return
  }

  console.log(`${email} — role: ${userRow.role}, name: ${userRow.name}, id: ${authUser.id}`)

  const { data: streakRow } = await admin.from('streaks').select('user_id').eq('user_id', authUser.id).maybeSingle()
  console.log(`  streaks row: ${streakRow ? 'yes' : 'MISSING'}`)

  if (userRow.role === 'parent') {
    const { data: links } = await admin.from('family_links').select('student_id').eq('parent_id', authUser.id)
    console.log(`  linked students: ${links?.length ?? 0}`)
  }

  if (userRow.role === 'student') {
    const { data: links } = await admin.from('family_links').select('parent_id').eq('student_id', authUser.id)
    console.log(`  linked parent: ${links && links.length > 0 ? 'yes' : 'MISSING'}`)

    const { data: enrollments } = await admin.from('user_course_packs').select('pack_id, exam_date').eq('user_id', authUser.id)
    if (!enrollments || enrollments.length === 0) {
      console.log('  course enrollments: none yet')
    } else {
      for (const e of enrollments) console.log(`  enrolled: ${e.pack_id} (exam_date: ${e.exam_date})`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.verify) {
    if (!args.email) {
      console.error('Usage: node scripts/create-user.js --verify --email x')
      process.exit(1)
    }

    const url = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceRoleKey) {
      console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
      process.exit(1)
    }
    const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

    await verifyUser(admin, args.email)
    return
  }

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
