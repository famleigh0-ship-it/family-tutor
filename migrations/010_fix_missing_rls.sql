-- CRITICAL fix: 8 tables never had row level security enabled, making them
-- fully readable by anyone holding the public anon key — which is embedded
-- in the deployed JS bundle, so this was live, unauthenticated public
-- access to real data. Confirmed live via a service-role-free, anon-key-only
-- probe (scripts/_rls_probe.mjs): user_course_packs, mastery_records,
-- sessions, question_bank (including the correct_answer/rubric/
-- key_reasoning answer key the app goes to real lengths to strip
-- server-side before it ever reaches a client), student_question_history,
-- question_log, quiz_prep_events, and question_reports were all returning
-- real rows to a plain unauthenticated request — no login, no token beyond
-- the public anon key.
--
-- None of these tables are ever queried directly from src/pages or
-- src/components (confirmed by grep across the whole src/ tree) — every
-- read/write goes through api/ routes using the service role key, which
-- always bypasses RLS regardless of policies. So the fix is the exact same
-- safe pattern already used correctly for parent_pins in migration 002:
-- enable RLS with zero policies, which denies all access to the
-- anon/authenticated (browser) roles while leaving every existing
-- server-side code path completely unaffected.

alter table user_course_packs enable row level security;
alter table mastery_records enable row level security;
alter table sessions enable row level security;
alter table question_bank enable row level security;
alter table student_question_history enable row level security;
alter table question_log enable row level security;
alter table quiz_prep_events enable row level security;
alter table question_reports enable row level security;
