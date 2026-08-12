-- Phase 2: parent PIN protection + row level security for tables the
-- browser client queries directly with the user's session.

create table parent_pins (
  user_id uuid primary key references users(id),
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- parent_pins is only ever read/written by serverless functions using the
-- service role key (which bypasses RLS). Enabling RLS with zero policies
-- denies all access from the anon/authenticated (browser) client, so a PIN
-- hash can never be fetched or brute-forced client-side.
alter table parent_pins enable row level security;

-- users, family_links, and streaks are queried directly from the browser
-- with the signed-in user's session, so they need explicit read policies.
alter table users enable row level security;
alter table family_links enable row level security;
alter table streaks enable row level security;

create policy "users_select_own" on users
  for select using (auth.uid() = id);

create policy "users_select_linked_students" on users
  for select using (
    exists (
      select 1 from family_links fl
      where fl.parent_id = auth.uid() and fl.student_id = users.id
    )
  );

create policy "family_links_select_own" on family_links
  for select using (auth.uid() = parent_id or auth.uid() = student_id);

create policy "streaks_select_own" on streaks
  for select using (auth.uid() = user_id);
