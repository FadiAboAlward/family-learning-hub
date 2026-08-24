alter table quiz_attempt_question_queue
  add column if not exists draft_option_position smallint,
  add column if not exists hint_level_requested smallint not null default 0,
  add column if not exists is_flagged boolean not null default false,
  add column if not exists interaction_metadata jsonb not null default '{}'::jsonb;

do $$ begin
  alter table quiz_attempt_question_queue add constraint quiz_attempt_queue_draft_option_check check (draft_option_position is null or draft_option_position between 1 and 50);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table quiz_attempt_question_queue add constraint quiz_attempt_queue_hint_level_check check (hint_level_requested between 0 and 4);
exception when duplicate_object then null; end $$;

create index if not exists idx_quiz_attempt_queue_flagged
  on quiz_attempt_question_queue(workspace_id, quiz_attempt_id, is_flagged)
  where is_flagged = true;
