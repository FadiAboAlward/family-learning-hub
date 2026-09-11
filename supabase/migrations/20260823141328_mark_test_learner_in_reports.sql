update public.learners
set metadata = coalesce(metadata,'{}'::jsonb) || '{"is_test":true,"exclude_from_parent_metrics":true}'::jsonb,
    updated_at = now()
where workspace_id = (select id from public.workspaces where slug='ayaa-school' limit 1)
  and slug='test';
