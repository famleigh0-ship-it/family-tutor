import bcrypt from 'bcryptjs'
import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

// Only sets a PIN when none exists yet ("first access" flow). Changing an
// existing PIN isn't handled here — that would need re-verification of the
// old PIN to avoid letting a hijacked session silently overwrite it.
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

  const { data: existing, error: existingErr } = await admin
    .from('parent_pins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingErr) {
    res.status(500).json({ error: 'Server error' })
    return
  }

  if (existing) {
    res.status(409).json({ error: 'A PIN is already set for this account.' })
    return
  }

  const pinHash = await bcrypt.hash(pin, 10)

  const { error } = await admin.from('parent_pins').insert({
    user_id: user.id,
    pin_hash: pinHash
  })

  if (error) {
    res.status(500).json({ error: 'Server error' })
    return
  }

  res.status(200).json({ ok: true })
}
