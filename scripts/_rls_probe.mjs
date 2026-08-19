// Read-only probe: uses ONLY the public anon key (never the service role
// key) to check what an unauthenticated/anonymous caller can actually read
// from each table via Supabase's REST API. This mirrors exactly what
// Supabase's security scanner (and any outside attacker with the anon key,
// which is public in the deployed JS bundle) can do.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

const tables = [
  'parent_pins',
  'users',
  'family_links',
  'streaks',
  'user_course_packs',
  'mastery_records',
  'sessions',
  'question_bank',
  'student_question_history',
  'question_log',
  'classroom_logs',
  'topic_unlock_log',
  'quiz_prep_events',
  'question_reports'
]

for (const table of tables) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=3`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  })
  const body = await res.json().catch(() => null)
  const rowCount = Array.isArray(body) ? body.length : 'n/a'
  const exposed = res.status === 200 && Array.isArray(body) && body.length > 0
  const cols = exposed ? Object.keys(body[0]).join(',') : ''
  console.log(`${table.padEnd(28)} status=${res.status}  rows_returned=${rowCount}  ${exposed ? 'EXPOSED — columns: ' + cols : ''}`)
}
