-- FLH-FEAT-2026-020 / SPEC_VERSION 1.1
-- Forward-only correction rebased onto current main.
-- Spec: https://docs.google.com/document/d/13J_0dAIeXK1vmjDWgO5WMlpOknntkwBGtGcm22Ejo4M/edit
-- DRIVE_REVISION_ID: 2
-- Preserve the current implementations behind narrow wrappers so later main
-- changes are retained while paper and digital Learning share one lock.

do $rename$
begin
  if to_regprocedure('public.flh_learning_start_flh020_base(uuid,uuid,text)') is null then
    alter function public.flh_learning_start(uuid,uuid,text)
      rename to flh_learning_start_flh020_base;
  end if;
  if to_regprocedure('public.flh_support_paper_start_flh020_base(uuid,uuid,uuid,text,text)') is null then
    alter function public.flh_support_paper_start(uuid,uuid,uuid,text,text)
      rename to flh_support_paper_start_flh020_base;
  end if;
end;
$rename$;

create or replace function public.flh_learning_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_slug text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quiz_id uuid;
  v_version_id uuid;
  v_support_source boolean := false;
begin
  select q.id into v_quiz_id
  from public.quizzes q
  where q.workspace_id=p_workspace_id
    and q.slug=p_quiz_slug
    and q.status='active'
  limit 1;

  if v_quiz_id is null then
    return public.flh_learning_start_flh020_base(
      p_workspace_id,p_learner_id,p_quiz_slug
    );
  end if;

  select coalesce(
    (
      select qv.id
      from public.quiz_attempts a
      join public.quiz_versions qv
        on qv.workspace_id=a.workspace_id
       and qv.id=a.quiz_version_id
      where a.workspace_id=p_workspace_id
        and a.learner_id=p_learner_id
        and a.status='in_progress'
        and a.delivery_mode='learning'
        and qv.quiz_id=v_quiz_id
        and qv.state='published'
      order by a.started_at desc
      limit 1
    ),
    (
      select qv.id
      from public.quiz_assignments qa
      join public.quiz_versions qv
        on qv.workspace_id=qa.workspace_id
       and qv.id=qa.quiz_version_id
      where qa.workspace_id=p_workspace_id
        and qa.learner_id=p_learner_id
        and qa.status in ('assigned','in_progress')
        and (qa.available_at is null or qa.available_at<=now())
        and (qa.due_at is null or qa.due_at>=now())
        and qv.quiz_id=v_quiz_id
        and qv.state='published'
      order by qa.created_at desc
      limit 1
    ),
    (
      select qv.id
      from public.quiz_versions qv
      where qv.workspace_id=p_workspace_id
        and qv.quiz_id=v_quiz_id
        and qv.state='published'
      order by qv.version_no desc
      limit 1
    )
  ) into v_version_id;

  if v_version_id is null then
    return public.flh_learning_start_flh020_base(
      p_workspace_id,p_learner_id,p_quiz_slug
    );
  end if;

  select coalesce((qv.settings->>'support_source')::boolean,false)
    into v_support_source
  from public.quiz_versions qv
  where qv.workspace_id=p_workspace_id
    and qv.id=v_version_id;

  if v_support_source then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_workspace_id::text||':'||p_learner_id::text||':'||
        v_version_id::text||':support-delivery',
        0
      )
    );

    if exists (
      select 1
      from public.quiz_attempts a
      where a.workspace_id=p_workspace_id
        and a.learner_id=p_learner_id
        and a.quiz_version_id=v_version_id
        and a.status in ('in_progress','submitted')
        and a.delivery_mode='exam'
        and nullif(a.metadata->>'paper_model_code','') is not null
    ) then
      return jsonb_build_object('error','QUIZ_NOT_AVAILABLE');
    end if;
  end if;

  return public.flh_learning_start_flh020_base(
    p_workspace_id,p_learner_id,p_quiz_slug
  );
end;
$function$;

create or replace function public.flh_support_paper_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_version_id uuid,
  p_paper_model_code text,
  p_source text default 'uploaded_photos'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_workspace_id::text||':'||p_learner_id::text||':'||
      p_quiz_version_id::text||':support-delivery',
      0
    )
  );

  if exists (
    select 1
    from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.delivery_mode='learning'
      and a.status='submitted'
  ) then
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;

  if exists (
    select 1
    from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.delivery_mode='learning'
      and a.status='in_progress'
  ) then
    return jsonb_build_object('error','SESSION_IN_PROGRESS');
  end if;

  return public.flh_support_paper_start_flh020_base(
    p_workspace_id,p_learner_id,p_quiz_version_id,p_paper_model_code,p_source
  );
end;
$function$;

revoke all on function public.flh_learning_start(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.flh_learning_start(uuid,uuid,text)
  to service_role;
revoke all on function public.flh_learning_start_flh020_base(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.flh_learning_start_flh020_base(uuid,uuid,text)
  to service_role;

revoke all on function public.flh_support_paper_start(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.flh_support_paper_start(uuid,uuid,uuid,text,text)
  to service_role;
revoke all on function public.flh_support_paper_start_flh020_base(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.flh_support_paper_start_flh020_base(uuid,uuid,uuid,text,text)
  to service_role;

comment on function public.flh_learning_start(uuid,uuid,text)
  is 'FLH-FEAT-2026-020 v1.1 shared support-delivery serialization wrapper.';
comment on function public.flh_support_paper_start(uuid,uuid,uuid,text,text)
  is 'FLH-FEAT-2026-020 v1.1 shared support-delivery serialization wrapper.';
