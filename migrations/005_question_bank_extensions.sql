-- Phase 6: Claude API integration — question generation and grading.
--
-- The Phase 1 question_bank schema didn't have a place to store an FRQ's
-- multi-part structure or a conceptual question's common misconceptions —
-- both are part of the generation output the Phase 6 spec asks for.

alter table question_bank add column parts jsonb;
alter table question_bank add column common_misconceptions jsonb;
