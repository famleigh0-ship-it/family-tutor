// Fires a POST to /api/bank (fill) using the internal service-role auth
// header (see api/bank/index.js's handleFill — it checks this same header
// against SUPABASE_SERVICE_ROLE_KEY, since that key is already a
// properly-guarded secret never exposed to the browser, rather than
// inventing a second internal-only credential). Plain JS so both Vercel
// functions (api/bank/index.js's own GET path) and engine .js files
// (bank-manager.js) can import it.
//
// APP_BASE_URL must point at the deployed site (e.g.
// https://family-tutor-ten.vercel.app) — Vercel serverless functions and
// plain Node scripts don't have an implicit "call my own API" base URL,
// so this is explicit in .env.local / Vercel env vars rather than derived.

/**
 * @param {{ packId: string, topicId: string, questionType: string }} params
 * @returns {Promise<{ generated: number, topic_id: string, question_type: string }>}
 */
export async function postBankFill({ packId, topicId, questionType }) {
  const baseUrl = process.env.APP_BASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!baseUrl || !serviceKey) {
    throw new Error('Missing APP_BASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.')
  }

  const res = await fetch(`${baseUrl}/api/bank`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Role-Key': serviceKey
    },
    body: JSON.stringify({ pack_id: packId, topic_id: topicId, question_type: questionType })
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Bank fill request failed (${res.status}): ${body}`)
  }

  return res.json()
}
