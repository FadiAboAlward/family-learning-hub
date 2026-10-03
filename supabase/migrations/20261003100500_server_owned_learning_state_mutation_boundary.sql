-- FLH-FEAT-2026-005 / SPEC_VERSION 1.1
-- Forward-only reconciliation: server-owned academic state is not directly
-- mutable by browser-authenticated roles. Existing SELECT visibility is kept;
-- service/server-authorized flows remain the write boundary.
-- Historical migrations are intentionally unchanged.

revoke insert, update, delete, truncate, references, trigger
  on table public.quiz_answer_attempts
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.quiz_attempt_question_queue
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.learner_concept_mastery
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.adaptive_events
  from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.learner_term_exposures
  from public, anon, authenticated;

drop policy if exists quiz_answer_attempts_insert on public.quiz_answer_attempts;
drop policy if exists quiz_answer_attempts_update on public.quiz_answer_attempts;
drop policy if exists quiz_answer_attempts_delete on public.quiz_answer_attempts;

drop policy if exists quiz_attempt_question_queue_insert on public.quiz_attempt_question_queue;
drop policy if exists quiz_attempt_question_queue_update on public.quiz_attempt_question_queue;
drop policy if exists quiz_attempt_question_queue_delete on public.quiz_attempt_question_queue;

drop policy if exists learner_concept_mastery_insert on public.learner_concept_mastery;
drop policy if exists learner_concept_mastery_update on public.learner_concept_mastery;
drop policy if exists learner_concept_mastery_delete on public.learner_concept_mastery;

drop policy if exists adaptive_events_insert on public.adaptive_events;
drop policy if exists adaptive_events_update on public.adaptive_events;
drop policy if exists adaptive_events_delete on public.adaptive_events;

drop policy if exists learner_term_exposures_insert on public.learner_term_exposures;
drop policy if exists learner_term_exposures_update on public.learner_term_exposures;
drop policy if exists learner_term_exposures_delete on public.learner_term_exposures;

comment on table public.quiz_answer_attempts is
  'Server-owned Learning answer-attempt evidence. Browser authenticated roles are read-only; writes use authorized server/RPC paths.';
comment on table public.quiz_attempt_question_queue is
  'Server-owned attempt queue. Browser authenticated roles are read-only; writes use authorized server/RPC paths.';
comment on table public.learner_concept_mastery is
  'Server-owned mastery state. Browser authenticated roles are read-only; writes use authorized server/RPC paths.';
comment on table public.adaptive_events is
  'Server-owned adaptive event evidence. Browser authenticated roles are read-only; writes use authorized server/RPC paths.';
comment on table public.learner_term_exposures is
  'Server-owned terminology exposure state. Browser authenticated roles are read-only; writes use authorized server/RPC paths.';
