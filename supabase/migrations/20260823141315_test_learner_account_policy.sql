insert into public.workspace_settings (workspace_id, key, value, description)
select id, 'testing.learner_account', jsonb_build_object(
  'slug','test',
  'exclude_from_parent_metrics',true,
  'allow_repeat_quiz_testing',true,
  'purpose','QA and UX testing without affecting real learner records'
), 'Rules for the dedicated test learner account.'
from public.workspaces where slug='ayaa-school'
on conflict (workspace_id,key) do update
set value=excluded.value, description=excluded.description, updated_at=now();
