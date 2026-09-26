do $contract$
declare
  v_workspace uuid;
  v_program uuid;
  v_mohammad uuid;
  v_target_quiz_versions integer;
begin
  select id
    into v_workspace
  from public.workspaces
  where slug = 'family-learning-hub'
  limit 1;

  if v_workspace is null then
    raise exception 'catalog normalization contract: workspace missing';
  end if;

  if not exists (
    select 1
    from public.books
    where code = 'AR-MATH-G7-2025-2026'
  ) then
    raise exception 'catalog normalization contract: target book missing';
  end if;

  if exists (
    select 1
    from public.books
    where code = 'AR-MATH-G7-2025-2026'
      and (
        coalesce(source_metadata, '{}'::jsonb) ? 'assigned_student'
        or lower(coalesce(source_metadata, '{}'::jsonb)::text) like '%mohammad%'
      )
  ) then
    raise exception 'catalog normalization contract: generic book metadata still contains learner identity';
  end if;

  select id
    into v_program
  from public.learning_programs
  where workspace_id = v_workspace
    and slug = 'syrian-g7-2026-2027'
  limit 1;

  if v_program is null then
    raise exception 'catalog normalization contract: target program missing';
  end if;

  if exists (
    select 1
    from public.learning_programs
    where id = v_program
      and (
        lower(coalesce(title, '')) like '%mohammad%'
        or lower(coalesce(description, '')) like '%mohammad%'
        or lower(coalesce(metadata, '{}'::jsonb)::text) like '%mohammad%'
      )
  ) then
    raise exception 'catalog normalization contract: generic program still contains learner identity';
  end if;

  select count(*)
    into v_target_quiz_versions
  from public.quiz_versions qv
  join public.quizzes q
    on q.id = qv.quiz_id
   and q.workspace_id = qv.workspace_id
  where q.workspace_id = v_workspace
    and q.slug in (
      'sy-g7-integers-add-subtract-v1',
      'sy-g7-integers-multiply-divide-v1'
    )
    and qv.version_no = 1;

  if v_target_quiz_versions <> 2 then
    raise exception 'catalog normalization contract: expected 2 target quiz versions, found %', v_target_quiz_versions;
  end if;

  if exists (
    select 1
    from public.quiz_versions qv
    join public.quizzes q
      on q.id = qv.quiz_id
     and q.workspace_id = qv.workspace_id
    where q.workspace_id = v_workspace
      and q.slug in (
        'sy-g7-integers-add-subtract-v1',
        'sy-g7-integers-multiply-divide-v1'
      )
      and qv.version_no = 1
      and lower(coalesce(qv.instructions, '')) like '%mohammad%'
  ) then
    raise exception 'catalog normalization contract: quiz instructions still contain learner identity';
  end if;

  select id
    into v_mohammad
  from public.learners
  where workspace_id = v_workspace
    and slug = 'mohammad'
  limit 1;

  if v_mohammad is not null and not exists (
    select 1
    from public.learner_program_enrollments
    where workspace_id = v_workspace
      and learner_id = v_mohammad
      and program_id = v_program
      and status = 'active'
  ) then
    raise exception 'catalog normalization contract: existing learner program enrollment was not preserved';
  end if;
end
$contract$;
