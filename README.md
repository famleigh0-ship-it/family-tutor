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
   - `migrations/003_classroom_signals.sql` — adds `prioritized_until` to
     `topic_unlock_log` and turns on Row Level Security for `classroom_logs`
     and `topic_unlock_log` (queried directly from the browser by Home, the
     classroom-log checklist, and the parent dashboard).
   - `migrations/005_question_bank_extensions.sql` — adds `parts` (FRQ
     multi-part structure) and `common_misconceptions` (conceptual
     questions) columns to `question_bank`, needed to store the full
     generation output from Phase 6.
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
2. In **Project Settings → Environment Variables**, add all vars from
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

## Classroom signal system

Students log what was covered in class each day at `/log/:packId`, via
photo, free-text, or a topic checklist. This is what drives topic unlocking
outside the pacing calendar and gives the adaptive engine same-day priority
boosts.

- `POST /api/classroom/parse-photo` — Claude Vision (`claude-sonnet-4-6`)
  reads a photo of notes/board and returns matched topic ids, a confidence
  level, and whether the image was even readable.
- `POST /api/classroom/parse-text` — Claude (`claude-haiku-4-5`) does the
  same from a free-text description (500 char max).
- `POST /api/classroom/confirm-log` — inserts the `classroom_logs` row and
  calls `unlockTopics`/`prioritizeTopics` for each confirmed topic. Always
  uses the authenticated user's id from the verified bearer token, never a
  client-supplied one.
- The checklist path skips Claude entirely — it's a direct pick-from-list
  UI, so `topics_extracted` and `topics_confirmed` are identical and no
  parse step runs.

`src/engine/unlock.ts` backs all of this: `unlockTopics` idempotently
inserts into `topic_unlock_log`; `prioritizeTopics` sets
`prioritized_until` 5 days out; `getPrioritizedTopicIds` (used by
`session-orchestrator.ts`) returns topics still inside that window. A topic
counts as "prioritized" purely off that column now — no more approximating
it from `unlocked_at`.

`scripts/run-pacing-calendar.js` is the (currently manual) calendar-driven
unlock job — it walks every row in `user_course_packs`, figures out the
current pacing week per pack, and unlocks (`source: 'pacing_calendar'`)
every topic scheduled for a week that's already started:

```bash
node scripts/run-pacing-calendar.js
```

Since `/api/classroom/*` are Vercel serverless functions, they don't run
under plain `npm run dev` (Vite alone doesn't serve `api/`) — test them
either with `vercel dev` (requires `vercel login` first) or on the deployed
Vercel site after a push, same as the parent-PIN endpoints in Phase 2.

## Phase 5 milestone checklist

- [x] `/log/:packId` method selector shows photo, text, checklist, and skip
- [x] Text description flow calls Claude and shows a topic-confirmation
      screen with a confidence banner on low/medium confidence
- [x] Photo flow: clear photo of notes returns matched topics (verified on
      a real Android device, including shorthand notes like "implicit
      diff" correctly matching "Implicit Differentiation")
- [x] Checklist flow saves directly with no Claude call and no confirmation
      screen
- [x] Confirmed log writes a `classroom_logs` row
- [x] Confirmed topics appear in `topic_unlock_log` with `prioritized_until`
      ~5 days out
- [x] `node scripts/test-engine.js` shows the two classroom-log-sourced
      topics as `prioritized` with elevated priority scores
- [x] `node scripts/run-pacing-calendar.js` unlocks the right topics for a
      real enrollment
- [x] Home shows "Log today's class" per course with no log yet, and
      "Logged ✓ — N topics" once one exists; Parent dashboard shows each
      student's last log date per course

## Claude API integration — question bank and grading

`src/lib/claude.js` centralizes model routing (`MODEL_FOR_TASK`, e.g. MC
generation/grading on Haiku, everything conceptual/FRQ on Sonnet) behind
one `callClaude({ task, system, messages, max_tokens })` helper that
returns `{ content, tokens_used }`. Every Phase 6 route builds its own
prompt text and calls this rather than touching the Anthropic SDK
directly.

**Bank generation** (`src/lib/bankFill.js`, `fillBank({ packId, topicId,
questionType })`) is the actual prompt-building + Claude call + Supabase
insert logic for one batch of questions (MC 10 / conceptual 5 / FRQ 3 per
call). It's a plain function, not tied to being called over HTTP — it's
called from three places:

- `api/bank/index.js`'s `POST` handler — a thin wrapper (auth check, then
  `fillBank`), for a single async fill triggered from a running request.
- `src/engine/bank-manager.js`'s `triggerBankFill` — fire-and-forget, from
  `startSession`.
- `scripts/manage-bank.js`'s `fill`/`fill-all` — called **directly**, not
  over HTTP. See the note below for why.

**Bank serving** (`api/bank/index.js`'s `GET` handler — combined with the
`POST` fill handler in one file, see the function-count note below) picks
one question for a student: prefers never-seen, falls back to
not-seen-in-60-days, and if truly exhausted triggers an async fill while
still returning the least-recently-seen question rather than making the
student wait. `key_reasoning` and each option's `distractor_note` are
stripped before the response ever reaches the client — that's what
actually keeps the answer key server-side, not just convention.

**Grading** (`api/grading/grade.js`, one endpoint handling all three
question types — same function-count reason): MC grading is fully
deterministic (no Claude call, `tokens_used: 0`) — it just compares
against `correct_answer` and builds feedback from `distractor_note`.
FRQ/conceptual typed answers and FRQ photo submissions (Vision, handwritten
work) both call Claude with a rubric-aware grading prompt and write the
result back to `student_question_history` and, via `recordQuestionResult`,
into `mastery_records`/`question_log`. Which path runs is decided by the
loaded question's `question_type` together with which body field the
client sent (`selected_option` / `student_answer` / `image_base64`). All
three verify the session actually belongs to the authenticated user
before writing anything.

**Hints** (`api/hints/get-hint.js`) are Socratic and free — no grading
impact, no history writes, just a 2-3 sentence nudge from Haiku.

`src/engine/bank-manager.js` (`checkBankHealth`, `triggerBankFill`) is
what `startSession` now calls after building a `SessionPlan`: for each
selected topic, if the student's unseen-question count for that
topic/type is below threshold (MC < 8, conceptual < 5, FRQ < 3), it fires
an async fill and logs it — never blocking session start on a thin bank.

`scripts/manage-bank.js` is the CLI for manual bank operations
(`status`, `fill`, `fill-all`) — see the milestone checklist below for
exact commands.

### Notes on file layout vs. the literal spec

`session-orchestrator.ts`, `mastery.ts`, `session-mode.ts`,
`topic-selector.ts`, and `bank-manager.ts` all became plain `.js` in this
phase (not `.ts`, despite the original naming). `api/grading/grade.js` now
imports `recordQuestionResult` from `session-orchestrator.js` directly,
and Vercel's serverless function bundler cannot resolve a
directly-imported `.ts` file at runtime — confirmed the hard way in
Phase 5 (`src/packs/loader.ts` → `ERR_MODULE_NOT_FOUND` in production).
Once one file in that dependency chain needed converting, everything it
transitively imports at runtime (not just type-only) needed the same
treatment. TypeScript still type-checks against these via JSDoc; only
runtime resolution changed.

**Vercel's Hobby plan caps a deployment at 12 serverless functions.**
Every file under `api/` counts as one, except `api/_lib/` (Vercel's
underscore-prefix convention excludes those). The spec's literal file
structure — separate `fill.js`/`serve.js` and `grade-mc.js`/
`grade-typed.js`/`grade-photo.js` — would have pushed the real total to
13, and the deployment silently failed to build (showed as a stuck/yellow
deployment in the dashboard, no visible error, with every new route
404ing while the previous deployment kept serving traffic). Fixed by
merging bank fill+serve into one `api/bank/index.js` (dispatched on
`req.method`) and all three grading paths into one `api/grading/grade.js`
(dispatched on the loaded question's `question_type` plus which body
field the client sent), and deleting the unused Phase 1 `api/session`
stub. That's 9 functions now — some headroom for what Phase 7+ adds.

**Vercel's Hobby plan also hard-caps a function's execution at 60
seconds**, even with `maxDuration` set to that max (see `vercel.json`).
Populating the bank at scale (`fill-all`) surfaced this: some individual
FRQ/conceptual generations occasionally ran long enough to hit
`FUNCTION_INVOCATION_TIMEOUT`, confirmed not to be a concurrency effect
(it kept happening running one pack's `fill-all` alone). This is why
`fillBank` lives in `src/lib/bankFill.js` as a plain function rather than
being HTTP-only: `scripts/manage-bank.js` calls it directly, in-process,
so a bulk `fill-all` run has no execution-time ceiling at all. The `POST
/api/bank` endpoint stays subject to the 60s limit, which is fine for its
actual real-time use (a single async trigger, not a 100+ item loop).
`fill-all` also retries each item a few times on transient failures
before giving up on it.

## Phase 6 milestone checklist

- [x] `node scripts/manage-bank.js fill --pack ap-physics-1 --topic kinematics.1d-motion --type mc`
      generates and stores MC questions — inspected in Supabase, high
      quality (clear reasoning, well-targeted distractors)
- [x] `node scripts/manage-bank.js fill --pack ap-physics-1 --topic kinematics.1d-motion --type conceptual`
      stores conceptual questions
- [x] `node scripts/manage-bank.js fill --pack ap-physics-1 --topic dynamics.free-body-diagrams --type frq`
      stores FRQ questions with a photo `input_mode` among them
- [x] `node scripts/manage-bank.js status --pack ap-physics-1` prints a
      bank health report for every topic/type
- [x] `node scripts/manage-bank.js fill-all --pack ap-physics-1` fills the
      whole AP Physics 1 bank — 132 of 132 topic/type combinations
- [x] `GET /api/bank` returns a question with no `key_reasoning` and no
      `distractor_note` on any option (also fixed `correct_answer`,
      `explanation`, and each option's `is_correct` leaking too — see the
      "verified against the live site" note below)
- [x] A correct MC answer (`selected_option`) to `POST /api/grading/grade`
      returns correct feedback with zero Claude calls
- [x] A typed answer (`student_answer`) to `POST /api/grading/grade` gets
      Claude-graded structured feedback — verified both a full-credit and
      a zero-credit answer, including correct misconception detection
- [x] A photo of handwritten work (`image_base64`) submitted to
      `POST /api/grading/grade` returns a readable, graded response
- [x] `/api/hints/get-hint` returns a Socratic hint that doesn't reveal
      the answer
- [x] `node scripts/manage-bank.js fill-all --pack calc-ab-bc` fills the
      calc bank — 153 of 153 topic/type combinations

### Bugs found and fixed during live testing

Bank fill's actual cost estimate was ~10-20x higher than the original
plan's guess (44 AP Physics topics × 3 question types × 3 packs' worth of
attempts, not the ~20-30 combos the "~$0.50-1.50" estimate assumed) — real
cost for both packs landed in the $15-25 range, confirmed and approved
before running. Beyond that, filling both packs at real scale (1600+
questions total) surfaced several issues no amount of small-scale testing
would have caught:

- MC batches of 10 truncated mid-JSON at both 4096 and 8192 max_tokens;
  fixed with an explicit conciseness instruction plus 16000 max_tokens.
- `GET /api/bank` leaked the answer key well beyond what the spec's
  "strip distractor_notes/key_reasoning" list caught — `correct_answer`,
  `explanation`, and a direct `is_correct` boolean on every option were
  all still being sent to the client before they'd answered.
- A generated FRQ's rubric summed to 9 points instead of 4, and grading
  it returned `frq_score: 7` — silently incompatible with
  `mastery.js`'s hardcoded `/4` EMA calculation. Fixed generation to
  always total 4 points, plus added a clamp as a backstop.
- Math-heavy content (Calc AB→BC especially) sometimes contained raw
  LaTeX (`\pm`, `\infty`) in JSON string values — an unescaped backslash
  broke JSON.parse. Fixed by instructing Claude to use plain Unicode math
  symbols instead.
- `checkBankHealth` broke once a pack's bank passed ~1500 questions — its
  `.in('question_id', ids)` filter built a URL too long for PostgREST.
  Fixed with an embedded join scoped by `pack_id` instead.
- Some individual FRQ/conceptual generations exceeded even Vercel's 60s
  function-timeout ceiling — not a concurrency effect, confirmed running
  one pack alone. Fixed by extracting the generation logic into
  `src/lib/bankFill.js` as a plain function `scripts/manage-bank.js`
  calls directly in-process, bypassing Vercel's timeout entirely for
  bulk operations.
