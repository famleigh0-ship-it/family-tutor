-- Phase 5: classroom signal system

alter table topic_unlock_log add column prioritized_until timestamp;

-- classroom_logs and topic_unlock_log are now queried directly from the
-- browser (Home's "logged today?" check, the classroom-log checklist's
-- unlock-state badges, and the parent dashboard's last-log-date), so they
-- need the same RLS treatment as users/family_links/streaks in migration
-- 002. Writes to both tables still only happen server-side (service role,
-- via api/classroom/confirm-log.js and the engine), so only SELECT
-- policies are needed here.

alter table classroom_logs enable row level security;
alter table topic_unlock_log enable row level security;

create policy "classroom_logs_select_own" on classroom_logs
  for select using (auth.uid() = user_id);

create policy "classroom_logs_select_linked_students" on classroom_logs
  for select using (
    exists (
      select 1 from family_links fl
      where fl.parent_id = auth.uid() and fl.student_id = classroom_logs.user_id
    )
  );

create policy "topic_unlock_log_select_own" on topic_unlock_log
  for select using (auth.uid() = user_id);
