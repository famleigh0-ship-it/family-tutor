-- NMSQT support: per-difficulty mastery tracking (mastery_records) and an
-- admin flag (users) so a parent account can be granted visibility into
-- every student, not just family_links-linked ones (used by the PSAT/NMSQT
-- prep pack's difficulty-escalation engine and the admin parent-dashboard
-- view, respectively). Both new columns default such that every existing
-- row keeps its current behavior with no backfill needed:
-- difficulty_1_mastery/difficulty_2_mastery/difficulty_3_mastery default 0
-- (same "no data yet" meaning as mastery_score's own default), current_difficulty
-- defaults to 1 (getCurrentDifficulty's own answer for an all-zero record),
-- and is_admin defaults to false (every existing parent keeps today's
-- family_links-scoped view).

alter table mastery_records
  add column if not exists difficulty_1_mastery float not null default 0,
  add column if not exists difficulty_2_mastery float not null default 0,
  add column if not exists difficulty_3_mastery float not null default 0,
  add column if not exists current_difficulty int not null default 1 check (current_difficulty in (1, 2, 3));

alter table users
  add column if not exists is_admin boolean not null default false;
