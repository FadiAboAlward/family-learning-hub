create table public.learner_instruction_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  learner_id uuid not null,
  primary_language text not null default 'ar',
  secondary_languages text[] not null default '{}'::text[],
  explanation_depth text not null default 'guided' check (explanation_depth in ('brief','standard','guided','deep')),
  support_tone text not null default 'encouraging' check (support_tone in ('encouraging','calm','playful','challenge')),
  visual_support text not null default 'auto' check (visual_support in ('auto','prefer_visual','prefer_text')),
  reading_level_override smallint check (reading_level_override between 1 and 12),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id),
  unique (id, workspace_id),
  foreign key (learner_id, workspace_id) references public.learners(id, workspace_id) on delete cascade
);
create index learner_instruction_profiles_learner_workspace_idx on public.learner_instruction_profiles(learner_id, workspace_id);
create trigger set_learner_instruction_profiles_updated_at before update on public.learner_instruction_profiles for each row execute function public.set_updated_at();

create table public.feedback_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_kind text not null check (event_kind in ('correct','incorrect','retry','hint','remediation_intro','remediation_success','mastery','encouragement')),
  attempt_no smallint check (attempt_no between 1 and 10),
  min_grade smallint check (min_grade between 1 and 12),
  max_grade smallint check (max_grade between 1 and 12),
  tone text not null default 'encouraging' check (tone in ('encouraging','calm','playful','challenge')),
  language text not null default 'ar',
  template_text text not null,
  status text not null default 'active' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_kind, attempt_no, min_grade, max_grade, tone, language, template_text),
  constraint feedback_templates_grade_range check (max_grade is null or min_grade is null or max_grade >= min_grade)
);
create index feedback_templates_lookup_idx on public.feedback_templates(workspace_id, event_kind, attempt_no, language, status);
create trigger set_feedback_templates_updated_at before update on public.feedback_templates for each row execute function public.set_updated_at();

create table public.explanation_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  question_id uuid,
  concept_id uuid,
  trigger_kind text not null check (trigger_kind in ('incorrect_attempt','correct_answer','max_attempts_reached','remediation_intro','remediation_success','concept_review')),
  min_attempt_no smallint check (min_attempt_no between 1 and 10),
  max_attempt_no smallint check (max_attempt_no between 1 and 10),
  min_grade smallint check (min_grade between 1 and 12),
  max_grade smallint check (max_grade between 1 and 12),
  min_difficulty smallint check (min_difficulty between 1 and 5),
  max_difficulty smallint check (max_difficulty between 1 and 5),
  language text not null default 'ar',
  title text,
  status text not null default 'active' check (status in ('draft','active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (question_id, workspace_id) references public.quiz_questions(id, workspace_id) on delete cascade,
  foreign key (concept_id, workspace_id) references public.learning_concepts(id, workspace_id) on delete cascade,
  constraint explanation_sets_target_required check (question_id is not null or concept_id is not null),
  constraint explanation_sets_attempt_range check (max_attempt_no is null or min_attempt_no is null or max_attempt_no >= min_attempt_no),
  constraint explanation_sets_grade_range check (max_grade is null or min_grade is null or max_grade >= min_grade),
  constraint explanation_sets_difficulty_range check (max_difficulty is null or min_difficulty is null or max_difficulty >= min_difficulty)
);
create index explanation_sets_question_lookup_idx on public.explanation_sets(question_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_concept_lookup_idx on public.explanation_sets(concept_id, trigger_kind, min_attempt_no, status);
create index explanation_sets_question_workspace_fk_idx on public.explanation_sets(question_id, workspace_id);
create index explanation_sets_concept_workspace_fk_idx on public.explanation_sets(concept_id, workspace_id);
create trigger set_explanation_sets_updated_at before update on public.explanation_sets for each row execute function public.set_updated_at();

create table public.explanation_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  explanation_set_id uuid not null,
  position integer not null check (position > 0),
  block_type text not null check (block_type in ('text','image','math','steps','example','diagram','audio','video','interactive')),
  content jsonb not null default '{}'::jsonb,
  asset_id uuid,
  is_optional boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (explanation_set_id, position),
  foreign key (explanation_set_id, workspace_id) references public.explanation_sets(id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references public.assets(id, workspace_id) on delete set null
);
create index explanation_blocks_set_idx on public.explanation_blocks(explanation_set_id, position);
create index explanation_blocks_set_workspace_fk_idx on public.explanation_blocks(explanation_set_id, workspace_id);
create index explanation_blocks_asset_workspace_fk_idx on public.explanation_blocks(asset_id, workspace_id);

alter table public.quiz_answer_attempts add column feedback_template_id uuid references public.feedback_templates(id) on delete set null;
alter table public.quiz_answer_attempts add column explanation_set_id uuid references public.explanation_sets(id) on delete set null;
alter table public.quiz_answer_attempts add column support_modalities text[] not null default '{}'::text[];
create index quiz_answer_attempts_feedback_template_idx on public.quiz_answer_attempts(feedback_template_id);
create index quiz_answer_attempts_explanation_set_idx on public.quiz_answer_attempts(explanation_set_id);

alter table public.adaptive_events drop constraint if exists adaptive_events_event_type_check;
alter table public.adaptive_events add constraint adaptive_events_event_type_check check (event_type in ('hint_served','remediation_triggered','remediation_selected','challenge_selected','concept_mastery_updated','question_completed','feedback_served','explanation_served','media_opened'));

alter table public.learner_instruction_profiles enable row level security;
alter table public.feedback_templates enable row level security;
alter table public.explanation_sets enable row level security;
alter table public.explanation_blocks enable row level security;

revoke all on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks from anon;
grant select, insert, update, delete on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks to authenticated;
grant all on public.learner_instruction_profiles, public.feedback_templates, public.explanation_sets, public.explanation_blocks to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

create policy learner_instruction_profiles_read on public.learner_instruction_profiles for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_insert on public.learner_instruction_profiles for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_update on public.learner_instruction_profiles for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy learner_instruction_profiles_delete on public.learner_instruction_profiles for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy feedback_templates_read on public.feedback_templates for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy feedback_templates_insert on public.feedback_templates for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy feedback_templates_update on public.feedback_templates for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy feedback_templates_delete on public.feedback_templates for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy explanation_sets_read on public.explanation_sets for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy explanation_sets_insert on public.explanation_sets for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_sets_update on public.explanation_sets for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_sets_delete on public.explanation_sets for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

create policy explanation_blocks_read on public.explanation_blocks for select to authenticated using (private.is_workspace_member(workspace_id, (select auth.uid())));
create policy explanation_blocks_insert on public.explanation_blocks for insert to authenticated with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_blocks_update on public.explanation_blocks for update to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid()))) with check (private.can_manage_learning(workspace_id, (select auth.uid())));
create policy explanation_blocks_delete on public.explanation_blocks for delete to authenticated using (private.can_manage_learning(workspace_id, (select auth.uid())));

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.feedback_policy',
       jsonb_build_object(
         'tone','encouraging',
         'adapt_to_grade',true,
         'adapt_to_attempt',true,
         'adapt_to_difficulty',true,
         'adapt_to_response_pattern',true,
         'avoid_shaming_language',true,
         'avoid_failure_labels',true,
         'celebrate_strategy_not_only_score',true,
         'correct_feedback_includes_why',true,
         'incorrect_feedback_includes_next_step',true,
         'max_hint_levels',4
       ),
       'Supportive, age-appropriate feedback policy for learners.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'pedagogy.explanation_modalities',
       jsonb_build_object(
         'allowed',jsonb_build_array('text','image','math','steps','example','diagram','audio','video','interactive'),
         'prefer_multimodal_after_repeated_error',true,
         'visual_source_priority','book_original_when_available',
         'math_visual_authoritative',true,
         'allow_multiple_blocks_per_explanation',true
       ),
       'Multimodal explanation policy; explanations can combine several blocks and book-sourced visuals.'
from public.workspaces w where w.slug = 'ayaa-school'
on conflict (workspace_id, key) do update set value = excluded.value, description = excluded.description, updated_at = now();

insert into public.feedback_templates (workspace_id, event_kind, attempt_no, min_grade, max_grade, tone, language, template_text)
select w.id, x.event_kind, x.attempt_no, 1, 6, 'encouraging', 'ar', x.template_text
from public.workspaces w
cross join (values
  ('correct',1,'ممتاز! وصلت للفكرة من أول محاولة. شوف لماذا إجابتك صحيحة 👏'),
  ('incorrect',1,'قريب! خلّينا نجرّب خطوة صغيرة تساعدك تلاحظ الفكرة.'),
  ('incorrect',2,'محاولة جيدة. هذه المرة سأعطيك تلميحًا أوضح ونحل جزءًا من الفكرة معًا.'),
  ('incorrect',3,'أنت عم تتقدم. خلّينا نركّز على الخطوة الأساسية، وبعدها جرّب مرة جديدة.'),
  ('incorrect',4,'خلّينا نشرحها بطريقة مختلفة وبوضوح أكبر، ثم نثبت الفكرة بسؤال مشابه.'),
  ('remediation_intro',null,'ما في مشكلة، خلّينا نثبت نفس الفكرة بسؤال جديد مشابه قبل ما نكمل.'),
  ('remediation_success',null,'رائع! السؤال الجديد بيّن إنك فهمت الفكرة. هلق فينا نكمل بثقة.'),
  ('mastery',null,'أحسنت! صار عندنا أكثر من دليل إنك أتقنت هالفكرة 🌟')
) as x(event_kind, attempt_no, template_text)
where w.slug = 'ayaa-school'
on conflict do nothing;
