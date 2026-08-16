-- Question reports — students flagging a question that seems wrong
-- (e.g. the mismatched correct_answer found during Phase 11 launch
-- testing). Written by api/bank/index.js's PATCH handler, using the
-- service role key — same reasoning as sessions/mastery_records/
-- quiz_prep_events: no RLS policy, since the frontend never queries
-- this table directly.

create table question_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  topic_id text not null,
  question_id uuid references question_bank(id),
  question_type text not null check (question_type in ('mc', 'frq', 'conceptual')),
  note text,
  reported_at timestamp default now(),
  reviewed_at timestamp
);
