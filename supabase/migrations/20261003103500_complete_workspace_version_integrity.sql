-- FLH-FEAT-2026-004 / SPEC_VERSION 1.1
-- Forward-only completion of residual relational integrity.
-- Production read-only preflight on 2026-10-03 found:
--   quiz_attempt_answers: 293 rows, 0 attempt/question quiz-version mismatches
--   learner_learning_sessions: 714 rows, 0 learner/workspace mismatches
-- Historical migrations are intentionally unchanged.

do $preflight$
declare
  v_answer_mismatches bigint;
  v_session_mismatches bigint;
begin
  select count(*)
    into v_answer_mismatches
  from public.quiz_attempt_answers aa
  join public.quiz_attempts a
    on a.id=aa.attempt_id and a.workspace_id=aa.workspace_id
  join public.quiz_questions q
    on q.id=aa.question_id and q.workspace_id=aa.workspace_id
  where a.quiz_version_id is distinct from q.quiz_version_id;

  if v_answer_mismatches <> 0 then
    raise exception 'QUIZ_ATTEMPT_ANSWER_VERSION_PREFLIGHT_FAILED:%', v_answer_mismatches;
  end if;

  select count(*)
    into v_session_mismatches
  from public.learner_learning_sessions s
  join public.learners l on l.id=s.learner_id
  where s.workspace_id is distinct from l.workspace_id;

  if v_session_mismatches <> 0 then
    raise exception 'LEARNER_SESSION_WORKSPACE_PREFLIGHT_FAILED:%', v_session_mismatches;
  end if;
end
$preflight$;

alter table public.quiz_attempt_answers
  add column if not exists quiz_version_id uuid;

update public.quiz_attempt_answers aa
set quiz_version_id=a.quiz_version_id
from public.quiz_attempts a
where aa.attempt_id=a.id
  and aa.workspace_id=a.workspace_id
  and aa.quiz_version_id is null;

do $answer_backfill$
begin
  if exists (
    select 1 from public.quiz_attempt_answers where quiz_version_id is null
  ) then
    raise exception 'QUIZ_ATTEMPT_ANSWER_VERSION_BACKFILL_INCOMPLETE';
  end if;
end
$answer_backfill$;

alter table public.quiz_attempt_answers
  alter column quiz_version_id set not null;

do $parent_keys$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_attempts'::regclass
      and conname='quiz_attempts_id_quiz_version_workspace_key'
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_id_quiz_version_workspace_key
      unique (id, quiz_version_id, workspace_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_questions'::regclass
      and conname='quiz_questions_id_quiz_version_workspace_key'
  ) then
    alter table public.quiz_questions
      add constraint quiz_questions_id_quiz_version_workspace_key
      unique (id, quiz_version_id, workspace_id);
  end if;
end
$parent_keys$;

create or replace function private.flh_bind_quiz_attempt_answer_version()
returns trigger
language plpgsql
security invoker
set search_path=''
as $function$
declare
  v_attempt_version uuid;
  v_question_version uuid;
begin
  select a.quiz_version_id
    into v_attempt_version
  from public.quiz_attempts a
  where a.id=new.attempt_id
    and a.workspace_id=new.workspace_id;

  if not found then
    raise exception using
      errcode='23503',
      message='QUIZ_ATTEMPT_ANSWER_ATTEMPT_NOT_FOUND';
  end if;

  select q.quiz_version_id
    into v_question_version
  from public.quiz_questions q
  where q.id=new.question_id
    and q.workspace_id=new.workspace_id;

  if not found then
    raise exception using
      errcode='23503',
      message='QUIZ_ATTEMPT_ANSWER_QUESTION_NOT_FOUND';
  end if;

  if v_attempt_version is distinct from v_question_version then
    raise exception using
      errcode='23503',
      message='QUIZ_ATTEMPT_ANSWER_VERSION_MISMATCH';
  end if;

  if new.quiz_version_id is not null
     and new.quiz_version_id is distinct from v_attempt_version then
    raise exception using
      errcode='23503',
      message='QUIZ_ATTEMPT_ANSWER_VERSION_MISMATCH';
  end if;

  new.quiz_version_id := v_attempt_version;
  return new;
end
$function$;

revoke all on function private.flh_bind_quiz_attempt_answer_version()
  from public, anon, authenticated;
grant execute on function private.flh_bind_quiz_attempt_answer_version()
  to service_role;

drop trigger if exists quiz_attempt_answers_bind_version
  on public.quiz_attempt_answers;
create trigger quiz_attempt_answers_bind_version
before insert or update of workspace_id, attempt_id, question_id, quiz_version_id
on public.quiz_attempt_answers
for each row
execute function private.flh_bind_quiz_attempt_answer_version();

do $answer_fks$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_attempt_answers'::regclass
      and conname='quiz_attempt_answers_attempt_version_workspace_fkey'
  ) then
    alter table public.quiz_attempt_answers
      add constraint quiz_attempt_answers_attempt_version_workspace_fkey
      foreign key (attempt_id, quiz_version_id, workspace_id)
      references public.quiz_attempts(id, quiz_version_id, workspace_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.quiz_attempt_answers'::regclass
      and conname='quiz_attempt_answers_question_version_workspace_fkey'
  ) then
    alter table public.quiz_attempt_answers
      add constraint quiz_attempt_answers_question_version_workspace_fkey
      foreign key (question_id, quiz_version_id, workspace_id)
      references public.quiz_questions(id, quiz_version_id, workspace_id)
      on delete restrict
      not valid;
  end if;
end
$answer_fks$;

alter table public.quiz_attempt_answers
  validate constraint quiz_attempt_answers_attempt_version_workspace_fkey;
alter table public.quiz_attempt_answers
  validate constraint quiz_attempt_answers_question_version_workspace_fkey;

do $session_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.learner_learning_sessions'::regclass
      and conname='learner_learning_sessions_learner_workspace_fkey'
  ) then
    alter table public.learner_learning_sessions
      add constraint learner_learning_sessions_learner_workspace_fkey
      foreign key (learner_id, workspace_id)
      references public.learners(id, workspace_id)
      on delete cascade
      not valid;
  end if;
end
$session_fk$;

alter table public.learner_learning_sessions
  validate constraint learner_learning_sessions_learner_workspace_fkey;

comment on column public.quiz_attempt_answers.quiz_version_id is
  'Pinned quiz version derived from the owning attempt; composite FKs prevent cross-version answer/question combinations.';
