-- FALP initial schema
-- Run this once against a fresh Supabase project (SQL Editor or `supabase db execute`).

create extension if not exists pgcrypto;

-- Users
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null check (role in ('student', 'parent')),
  name text not null,
  created_at timestamp default now()
);

-- Family links
create table family_links (
  parent_id uuid references users(id),
  student_id uuid references users(id),
  primary key (parent_id, student_id)
);

-- Course pack enrollments
create table user_course_packs (
  user_id uuid references users(id),
  pack_id text not null,
  enrolled_at timestamp default now(),
  exam_date date,
  crunch_mode boolean default false,
  primary key (user_id, pack_id)
);

-- Mastery records (one row per user per topic)
create table mastery_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  topic_id text not null,
  attempts int default 0,
  correct int default 0,
  frq_attempts int default 0,
  frq_score_total float default 0,
  last_seen timestamp,
  mastery_score float default 0,
  updated_at timestamp default now(),
  unique(user_id, pack_id, topic_id)
);

-- Sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  started_at timestamp default now(),
  ended_at timestamp,
  questions_attempted int default 0,
  questions_correct int default 0,
  duration_seconds int,
  topics_covered text[]
);

-- Question bank (shared across all users)
create table question_bank (
  id uuid primary key default gen_random_uuid(),
  pack_id text not null,
  topic_id text not null,
  question_type text not null check (question_type in ('mc', 'frq', 'conceptual')),
  input_mode text not null check (input_mode in ('typed', 'photo')),
  difficulty int not null check (difficulty in (1, 2, 3)),
  question_text text not null,
  options jsonb,
  correct_answer text,
  rubric text,
  key_reasoning jsonb,
  explanation text,
  generated_at timestamp default now(),
  generation_model text
);

-- Per-student question history
create table student_question_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  question_id uuid references question_bank(id),
  seen_at timestamp default now(),
  student_answer text,
  correct boolean,
  frq_score float,
  feedback_given text,
  tokens_used int
);

-- Question log per session
create table question_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  user_id uuid references users(id),
  pack_id text,
  topic_id text,
  question_id uuid references question_bank(id),
  question_type text,
  correct boolean,
  frq_score float,
  tokens_used int,
  timestamp timestamp default now()
);

-- Classroom logs (what was covered in class today)
create table classroom_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  logged_at timestamp default now(),
  input_method text check (input_method in ('photo', 'text', 'checklist')),
  raw_input text,
  topics_extracted text[],
  topics_confirmed text[],
  confirmed_at timestamp
);

-- Topic unlock log
create table topic_unlock_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  topic_id text not null,
  unlocked_at timestamp default now(),
  unlock_source text check (unlock_source in ('classroom_log', 'pacing_calendar'))
);

-- Quiz prep events
create table quiz_prep_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  pack_id text not null,
  topic_ids text[],
  quiz_date date not null,
  created_at timestamp default now(),
  expired_at timestamp,
  post_quiz_result text check (post_quiz_result in ('good', 'okay', 'rough'))
);

-- Streaks
create table streaks (
  user_id uuid primary key references users(id),
  current_streak int default 0,
  longest_streak int default 0,
  last_session_date date
);
