import bcrypt from 'bcryptjs'
import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

// A 4-digit PIN only has 10,000 combinations, so this endpoint locks the
// account out for 15 minutes after 5 wrong guesses in a row.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const user = await getUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const profile = await getUserProfile(user.id)
  if (!profile || profile.role !== 'parent') {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { pin } = req.body || {}
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be exactly 4 digits.' })
    return
  }

  const admin = getSupabaseAdmin()

  const { data, error } = await admin
    .from('parent_pins')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: 'Server error' })
    return
  }

  if (!data) {
    res.status(404).json({ error: 'No PIN set for this account.' })
    return
  }

  if (data.locked_until && new Date(data.locked_until) > new Date()) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' })
    return
  }

  const ok = await bcrypt.compare(pin, data.pin_hash)
  const now = new Date().toISOString()

  if (ok) {
    await admin
      .from('parent_pins')
      .update({ failed_attempts: 0, locked_until: null, updated_at: now })
      .eq('user_id', user.id)

    res.status(200).json({ ok: true })
    return
  }

  const attempts = (data.failed_attempts || 0) + 1
  const lockedUntil =
    attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null

  await admin
    .from('parent_pins')
    .update({ failed_attempts: attempts, locked_until: lockedUntil, updated_at: now })
    .eq('user_id', user.id)

  res.status(200).json({ ok: false })
}
