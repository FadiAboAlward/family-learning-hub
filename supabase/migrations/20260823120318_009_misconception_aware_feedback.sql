create table public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  concept_id uuid not null,
  code text not null,
  title text not null,
  description text,
  remediation_strategy text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, concept_id, code),
  unique (id, workspace_id),
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint misconceptions_code_format check (code = lower(code) and code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
create index misconceptions_concept_idx on public.misconceptions(concept_id, code);
create index misconceptions_concept_workspace_fk_idx on public.misconceptions(concept_id, workspace_id);
create trigger set_misconceptions_updated_at before update on public.misconceptions for each row execute function public.set_updated_at();

create table public.question_option_misconceptions (
  workspace_id uuid not null,
  option_id uuid not null,
  misconception_id uuid not null,
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (option_id, misconception_id),
  foreign key (option_id, workspace_id) references public.quiz_question_options(id, workspace_id) on delete cascade,
  foreign key (misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete cascade
);
create index question_option_misconceptions_option_workspace_fk_idx on public.question_option_misconceptions(option_id, workspace_id);
create index question_option_misconceptions_misconception_workspace_fk_idx on public.question_option_misconceptions(misconception_id, workspace_id);

alter table public.explanation_sets add column misconception_id uuid;
alter table public.explanation_sets add constraint explanation_sets_misconception_workspace_fkey foreign key (misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete set null;
create index explanation_sets_misconception_lookup_idx on public.explanation_sets(misconception_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_misconception_workspace_fk_idx on public.explanation_sets(misconception_id, workspace_id);

alter table public.quiz_answer_attempts add column detected_misconception_id uuid;
alter table public.quiz_answer_attempts add column error_classification jsonb not null default '{}'::jsonb;
alter table public.quiz_answer_attempts add constraint quiz_answer_attempts_misconception_workspace_fkey foreign key (detected_misconception_id, workspace_id) references public.misconceptions(id, workspace_id) on delete set null;
create index quiz_answer_attempts_misconception_idx on public.quiz_answer_attempts(detected_misconception_id);
create index quiz_answer_attempts_misconception_workspace_fk_idx on public.quiz_answer_attempts(detected_misconception_id, workspace_id);

alter table public.adaptive_events drop constraint if exists adaptive_events_event_type_check;
alter table public.adaptive_events add constraint adaptive_events_event_type_check check (event_type in ('hint_served','remediation_triggered','remediation_selected','challenge_selected','concept_mastery_updated','question_completed','feedback_served','explanation_served','media_opened','misconception_detected'));

alter table public.misconceptions enable row level security;
alter table public.question_option_misconceptions enable row level security;
revoke all on public.misconceptions, public.question_option_misconceptions from anon;
grant select, insert, update, delete on public.misconceptions, public.question_option_misconceptions to authenticated;
grant all on public.misconceptions, public.question_option_misconceptions to service_role;

create policy misconceptions_read on public.misconceptions for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy misconceptions_insert on public.misconceptions for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy misconceptions_update on public.misconceptions for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy misconceptions_delete on public.misconceptions for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy question_option_misconceptions_read on public.question_option_misconceptions for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_insert on public.question_option_misconceptions for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_update on public.question_option_misconceptions for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy question_option_misconceptions_delete on public.question_option_misconceptions for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.misconception_policy',
       jsonb_build_object(
         'detect_from_multiple_choice_distractors',true,
         'classify_typed_answers_when_possible',true,
         'prefer_misconception_specific_explanation',true,
         'fallback_to_attempt_level_explanation',true,
         'log_detection_for_parent_reporting',true
       ),
       'Use the learner response pattern to select more relevant feedback and explanations.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();
