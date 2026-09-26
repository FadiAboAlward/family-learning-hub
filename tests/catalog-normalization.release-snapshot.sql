-- Read-only pre/post release snapshot for FLH-FEAT-2026-006.
with ws as (
  select id from public.workspaces where slug='family-learning-hub' limit 1
),
learner as (
  select id from public.learners
  where workspace_id=(select id from ws) and slug='mohammad'
  limit 1
)
select jsonb_build_object(
  'enrollments', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'program_id',program_id,
        'status',status,
        'is_primary',is_primary
      ) order by id::text
    ),'[]'::jsonb)
    from public.learner_program_enrollments
    where workspace_id=(select id from ws)
      and learner_id=(select id from learner)
  ),
  'assignments', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'quiz_version_id',quiz_version_id,
        'status',status
      ) order by id::text
    ),'[]'::jsonb)
    from public.quiz_assignments
    where workspace_id=(select id from ws)
      and learner_id=(select id from learner)
  ),
  'attempts', (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',id,
        'quiz_version_id',quiz_version_id,
        'assignment_id',assignment_id,
        'status',status
      ) order by id::text
    ),'[]'::jsonb)
    from public.quiz_attempts
    where workspace_id=(select id from ws)
      and learner_id=(select id from learner)
  )
) as preservation_snapshot;
