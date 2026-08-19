-- Phase 11 enhancement: a count-only RPC so the daily scheduled check
-- (a cloud agent with no access to this machine's .env.local or the
-- service role key) can check for unreviewed question_reports using only
-- the anon key — which is already public (embedded in the deployed JS
-- bundle) — rather than needing the service role key at all. security
-- definer bypasses question_reports having no RLS policy of its own, but
-- the function only ever returns a count, never row content.

create or replace function count_unreviewed_question_reports()
returns integer
language sql
security definer
as $$
  select count(*)::integer from question_reports where reviewed_at is null;
$$;

grant execute on function count_unreviewed_question_reports() to anon;
