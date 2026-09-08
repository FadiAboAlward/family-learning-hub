-- Family Learning Hub: canonical isolated Testing learner for production QA.
-- Reuses the existing test learner and preserves its stable slug/access identity.

update public.learners
set display_name = 'Testing',
    grade_level = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'is_test', true,
      'exclude_from_parent_metrics', true,
      'show_on_login', true,
      'avatar_emoji', '🧪',
      'qa_automation', true,
      'qa_canonical', true,
      'qa_access', 'github_oidc_short_lived_session'
    ),
    updated_at = now()
where workspace_id = (select id from public.workspaces where slug = 'family-learning-hub')
  and slug = 'test';

update public.learner_access_tokens
set label = 'Manual Testing account PIN (fallback only)'
where workspace_id = (select id from public.workspaces where slug = 'family-learning-hub')
  and learner_id = (
    select id
    from public.learners
    where workspace_id = (select id from public.workspaces where slug = 'family-learning-hub')
      and slug = 'test'
  )
  and revoked_at is null;

insert into public.workspace_settings (workspace_id, key, value, description)
select id,
       'qa.testing_learner',
       jsonb_build_object(
         'version', 1,
         'learner_slug', 'test',
         'display_name', 'Testing',
         'is_test', true,
         'exclude_from_parent_metrics', true,
         'mirror_real_learner_programs', true,
         'mirror_real_quiz_assignments', true,
         'mirror_real_content_assignments', true,
         'automation_auth', 'github_oidc_short_lived_session',
         'github_oidc_audience', 'family-learning-hub-qa',
         'canonical_qa_quiz_slug', 'sy-g7-integers-add-subtract-v1',
         'real_learner_data_policy', 'never_use_aya_or_mohammad_for_automated_authenticated_qa'
       ),
       'Canonical isolated learner used by automated authenticated QA. Its attempts and gamification are excluded from parent learner metrics.'
from public.workspaces
where slug = 'family-learning-hub'
on conflict (workspace_id, key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();
