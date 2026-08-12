import { getUserFromRequest, getUserProfile, getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

  const { data, error } = await getSupabaseAdmin()
    .from('parent_pins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: 'Server error' })
    return
  }

  res.status(200).json({ hasPin: Boolean(data) })
}
