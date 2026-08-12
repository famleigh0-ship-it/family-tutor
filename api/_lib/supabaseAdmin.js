import { createClient } from '@supabase/supabase-js'

let client

/**
 * Service-role Supabase client for serverless functions only. Never import
 * this from src/ — the service role key must stay server-side.
 */
export function getSupabaseAdmin() {
  if (!client) {
    const url = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!url || !serviceRoleKey) {
      throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function environment.')
    }

    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  }
  return client
}

/**
 * Verifies the bearer token from an incoming request and returns the user,
 * or null if missing/invalid.
 */
export async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const { data, error } = await getSupabaseAdmin().auth.getUser(token)
  if (error) return null
  return data.user
}
