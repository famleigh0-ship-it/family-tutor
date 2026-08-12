# Family Adaptive Learning Platform (FALP)

Reusable adaptive tutoring engine with interchangeable course packs. Phase 1
scope: project scaffold, auth-gated skeleton, database schema, and a deploy
pipeline. Course logic (adaptive engine, question generation, grading) is
Phase 2.

## Stack

React + Vite, Tailwind CSS, Supabase (Postgres + Auth), Vercel serverless
functions, Claude API, installable PWA.

## Project layout

- `src/` — frontend app (pages, shared components, Supabase client), plus `src/packs/` (pack loader) and `src/engine/` (adaptive engine)
- `api/` — Vercel serverless functions (`session`, `grading`, `bank`, `classroom`, `parent-pin`)
- `course-packs/` — per-course config (`ap-physics-1`, `calc-ab-bc`), stubbed for now
- `migrations/` — SQL schema migrations, run manually against Supabase
- `scripts/` — admin CLI scripts (account provisioning)

## Local setup

1. **Install Node.js** (LTS, 18+) if you don't have it: https://nodejs.org
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the env template and fill in your Supabase/Anthropic values (see below):
   ```bash
   cp .env.local.example .env.local
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```
   Visit http://localhost:5173 — you should see the login screen.

## Supabase setup

1. Create a project at https://supabase.com/dashboard.
2. From **Project Settings → API**, grab:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` `public` key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret, server-side only)
3. Run the migrations, in order, in the **SQL Editor**:
   - `migrations/001_initial_schema.sql` — confirm all 12 tables appear under **Table Editor**.
   - `migrations/002_parent_pins_and_rls.sql` — adds `parent_pins` and turns
     on Row Level Security for `users`, `family_links`, and `streaks` (the
     tables the frontend queries directly with the anon key). Without this,
     any signed-in user could read every other family's rows.
4. In **Authentication → Providers**, confirm Email is enabled (it is by
   default).
5. Under **Authentication → URL Configuration**, add both your local
   (`http://localhost:5173/reset-password`) and deployed
   (`https://<your-vercel-domain>/reset-password`) URLs to **Redirect URLs**
   — required for the forgot-password email link to work.

## Anthropic setup

Create a key at https://console.anthropic.com/ → `ANTHROPIC_API_KEY`. Only
needed server-side (`api/` functions); not required to see the login/home
skeleton working.

## GitHub

```bash
git init
git add .
git commit -m "Scaffold FALP Phase 1"
```

Create an empty repository named `family-tutor` on GitHub (no README/license,
so it stays empty), then:

```bash
git remote add origin https://github.com/<your-username>/family-tutor.git
git branch -M main
git push -u origin main
```

## Vercel deploy

1. Import the `family-tutor` GitHub repo at https://vercel.com/new. Vercel
   auto-detects Vite.
2. In **Project Settings → Environment Variables**, add all four vars from
   `.env.local.example` with your real values (Production + Preview +
   Development). `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` must
   never get a `VITE_` prefix.
3. Deploy. Every push to `main` auto-deploys.

## Accounts, roles, and the parent PIN

Accounts are admin-provisioned, not self-signup — there's no sign-up form.
Use `scripts/create-user.js` (needs `.env.local` with
`SUPABASE_SERVICE_ROLE_KEY` set):

```bash
# Create yourself as a parent first
node scripts/create-user.js --email parent@example.com --password "..." --name "Stephen" --role parent

# Then a student, linked to that parent's user id (printed above)
node scripts/create-user.js --email student@example.com --password "..." --name "..." --role student --parent-id <parent-user-id>
```

Logging in routes by role: students land on `/home`, parents on `/parent`.
The parent dashboard is gated by a *separate* 4-digit PIN (distinct from the
login password) — first visit each browser session prompts you to set or
enter it, and it re-locks after 30 minutes of no activity on `/parent`
routes (without signing you out of the app). The PIN itself is bcrypt-hashed
server-side in `parent_pins` and never readable via the anon key; the verify
endpoint locks out for 15 minutes after 5 wrong guesses.

Students have no link or button to `/parent` anywhere in the UI, and
visiting any URL for a role you don't have (or aren't logged in for at all)
bounces you to `/login`.

## Phase 1 milestone checklist

- [x] `npm run dev` shows the login screen
- [x] Log in and land on the placeholder home screen
- [x] All 12 tables visible in Supabase Table Editor
- [x] Push to GitHub, confirm Vercel auto-deploys

## Phase 2 milestone checklist

- [x] `create-user.js` creates a parent account and a student account
- [x] Student login → `/home` with their name and two course cards
- [x] Parent login → `/parent` → PIN prompt → set PIN on first access → placeholder dashboard
- [x] Student account cannot navigate to `/parent` (redirects to `/login`)
- [x] Wrong-role/unauthenticated visits to any protected route redirect to `/login`
- [x] Forgot-password flow sends a reset email and `/reset-password` lets you set a new password

## Course packs and the pack loader

Course content lives entirely in `course-packs/*/pack.json`, validated
against `src/packs/types.ts` at load time by `src/packs/loader.ts`. The
engine and UI never hardcode subject content — everything (units, topics,
pacing, misconceptions, FRQ rubric) comes from the pack file.

Validate both packs (checks structural shape plus cross-references — every
prerequisite id and pacing-calendar topic id must actually resolve, and no
`bc_only` topic may appear in the AB pacing calendar):

```bash
npm run validate-packs
```

`getUnlockedTopics(packId, referenceDate)` computes which topics should be
visible as of a given date: AB topics unlock week-by-week per
`pacing_calendar`; BC-only topics (Calc pack) have no calendar entries at
all and instead unlock once every prerequisite unit's calendar-scheduled
weeks have fully passed. In dev mode (`npm run dev`), `getPack`,
`getAllPacks`, `getUnit`, `getTopic`, `getTopicsForWeek`, and
`getUnlockedTopics` are exposed on `window` from the Home page for
console testing, e.g. `getUnlockedTopics('ap-physics-1', '2026-08-11')`.

## Phase 3 milestone checklist

- [x] `npm run validate-packs` passes for both packs
- [x] `/home` shows real course names, unit counts, and exam countdowns
- [x] `getPack('ap-physics-1')` inspectable from the browser console
- [x] `getUnlockedTopics('ap-physics-1', '2026-08-11')` returns the week 1 kinematics topic
- [x] BC-only Calc topics stay hidden from `getUnlockedTopics` until their AB prerequisite units are calendar-complete

## The adaptive engine

`src/engine/` is the brain that decides what to practice each session —
no UI, no Claude calls, no real question bank yet. It's split into pure
functions plus one DB-integrated orchestrator:

- `mastery.ts` — `updateMastery` (EMA update per question result),
  `applyDecay` (2%/week fade after 7 days untouched), `getMasteryLabel`.
  Pure, no DB access.
- `session-mode.ts` — `detectSessionMode`: onboarding (< 3 sessions) →
  quiz-prep (active `quiz_prep_events` row) → exam-crunch (within
  `exam_crunch_weeks` of the exam) → adaptive. Pure.
- `topic-selector.ts` — `selectTopics`: scores unlocked topics by exam
  weight, difficulty, recency, and mastery, then applies mode-specific
  rules (onboarding caps at 3 diagnostic difficulty-1 topics; quiz-prep
  forces the quiz's topics to the top; exam-crunch doubles exam-weight
  scoring and guarantees an FRQ-capable topic; adaptive guarantees a
  critical-mastery topic and a stale-review topic when any exist). Pure.
- `session-orchestrator.ts` — the only file that touches Supabase (service
  role key, server-side only — never import it from `src/pages` or
  `src/components`). `startSession` loads mastery/unlock/quiz-prep state,
  applies decay, picks a plan, and opens a `sessions` row.
  `recordQuestionResult` updates mastery and logs the question.
  `endSession` closes the session and updates the streak.

Test it end to end against real Supabase tables, with no Claude calls and
no real questions — a dedicated `engine-test@family-tutor.local` student
gets mock unlock/mastery data and runs through 4 simulated sessions:

```bash
node scripts/test-engine.js
```

It's idempotent (safe to re-run) and prints each session's plan, final
mastery scores, and streak state. To see quiz-prep mode, manually insert a
row into `quiz_prep_events` for that test user in the Supabase dashboard
(`quiz_date` today or later, `expired_at` null) and run it again.

## Phase 4 milestone checklist

- [x] `node scripts/test-engine.js` prints a valid `SessionPlan` each session
- [x] A brand-new student (0 sessions) gets `mode: 'onboarding'`
- [x] Onboarding mode only ever selects difficulty-1 topics
- [x] After 3+ sessions, mode switches to `'adaptive'`
- [x] Manually inserting a `quiz_prep_event` switches mode to `'quiz-prep'` with its topics forced to the top
- [x] `mastery_records` rows are written/updated after simulated question results
- [x] `sessions` rows are created and correctly closed (`ended_at`, `duration_seconds`, `topics_covered`)
- [x] `streaks` increments correctly (and correctly holds steady across same-day sessions)
