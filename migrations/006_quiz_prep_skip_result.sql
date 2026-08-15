-- Phase 8: quiz prep events can now be dismissed without a real result —
-- either 3 skips of the post-quiz prompt (see PostQuizPrompt.tsx) or an
-- auto-dismiss when the prompt would otherwise surface more than 14 days
-- after the quiz (too stale to be useful). Both cases record
-- post_quiz_result = 'skipped' rather than leaving it null, so
-- session-orchestrator.js's startSession stops gating session start on it.

alter table quiz_prep_events drop constraint quiz_prep_events_post_quiz_result_check;
alter table quiz_prep_events add constraint quiz_prep_events_post_quiz_result_check
  check (post_quiz_result in ('good', 'okay', 'rough', 'skipped'));
