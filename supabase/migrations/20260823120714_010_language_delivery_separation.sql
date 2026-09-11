alter table public.quiz_versions add column if not exists question_language text;
alter table public.quiz_versions add column if not exists explanation_language text;
alter table public.quiz_versions add column if not exists terminology_display_mode text check (terminology_display_mode in ('source_only','dual_term','target_first_with_source_hint','target_only'));

alter table public.quiz_questions add column if not exists prompt_language text;
alter table public.quiz_questions add column if not exists terminology_display_mode text check (terminology_display_mode in ('inherit','source_only','dual_term','target_first_with_source_hint','target_only')) default 'inherit';

alter table public.quiz_question_hints add column if not exists language text;
alter table public.quiz_question_hints add column if not exists terminology_display_mode text check (terminology_display_mode in ('inherit','source_only','dual_term','target_first_with_source_hint','target_only')) default 'inherit';

insert into public.learner_instruction_profiles (
  workspace_id, learner_id, primary_language, secondary_languages, explanation_depth, support_tone, visual_support, metadata
)
select l.workspace_id, l.id, 'ar', array['tr']::text[], 'guided', 'encouraging', 'auto',
       jsonb_build_object(
         'curriculum_transition', jsonb_build_object(
           'current_curriculum_language','tr',
           'target_curriculum_language','ar',
           'preferred_explanation_language','ar',
           'preserve_source_terms',true,
           'introduce_target_terms_gradually',true
         )
       )
from public.learners l
join public.workspaces w on w.id = l.workspace_id
where w.slug = 'ayaa-school'
on conflict (learner_id) do update
set primary_language = excluded.primary_language,
    secondary_languages = excluded.secondary_languages,
    metadata = coalesce(public.learner_instruction_profiles.metadata,'{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.workspace_settings (workspace_id, key, value, description)
select w.id, 'delivery.language_separation',
       jsonb_build_object(
         'separate_question_language', true,
         'separate_explanation_language', true,
         'separate_curriculum_term_language', true,
         'default_explanation_language', 'ar',
         'preserve_source_curriculum_terms', true,
         'allow_dual_terminology', true,
         'allow_per_question_override', true,
         'allow_per_hint_override', true
       ),
       'Separates question language, explanation language, and curriculum-specific terminology for bilingual curriculum transition.'
from public.workspaces w where w.slug='ayaa-school'
on conflict (workspace_id, key) do update set value=excluded.value, description=excluded.description, updated_at=now();
