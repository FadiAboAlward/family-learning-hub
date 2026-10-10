-- FLH-024 v1.1 / Drive revision 2: read-only compact self-scoped journey evidence.
-- Retake/assignment history does not consume a transport row budget. Distinct
-- published versions remain bounded and overflow fails closed, never guessed NEW.
create or replace function public.flh_learner_journey_progress(
  p_workspace_id uuid, p_learner_id uuid, p_version_ids uuid[] default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_now timestamptz := statement_timestamp();
  v_versions uuid[];
  v_attempts jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_paper_versions jsonb := '[]'::jsonb;
begin
  if p_workspace_id is null or p_learner_id is null or not exists(
    select 1 from public.learners l where l.workspace_id=p_workspace_id and l.id=p_learner_id and l.is_active
  ) then return jsonb_build_object('error','JOURNEY_UNAVAILABLE'); end if;
  if p_version_ids is not null and (cardinality(p_version_ids)>1000 or array_position(p_version_ids,null) is not null) then
    return jsonb_build_object('error','JOURNEY_UNAVAILABLE');
  end if;

  if p_version_ids is null then
    -- Discovery returns only eligible assignments, or completed assignments backed
    -- by an actual own submitted attempt. EXISTS avoids counting all retakes.
    select coalesce(array_agg(x.quiz_version_id),'{}'::uuid[]) into v_versions from (
      select distinct a.quiz_version_id
      from public.quiz_assignments a
      join public.quiz_versions v on v.id=a.quiz_version_id and v.workspace_id=a.workspace_id and v.state='published'
      where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and (
        (a.status in ('assigned','in_progress') and (a.available_at is null or a.available_at<=v_now) and (a.due_at is null or a.due_at>=v_now))
        or (a.status='completed' and exists(select 1 from public.quiz_attempts t
          where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id and t.quiz_version_id=a.quiz_version_id
            and t.status='submitted' and t.delivery_mode in ('learning','exam')))
      )
      order by a.quiz_version_id limit 1001
    ) x;
    if cardinality(v_versions)>1000 then return jsonb_build_object('error','JOURNEY_UNAVAILABLE'); end if;
  else
    select coalesce(array_agg(v.id order by v.id),'{}'::uuid[]) into v_versions
    from public.quiz_versions v where v.workspace_id=p_workspace_id and v.state='published' and v.id=any(p_version_ids);
    if cardinality(v_versions)<>(select count(distinct id) from unnest(p_version_ids) id) then
      return jsonb_build_object('error','JOURNEY_UNAVAILABLE');
    end if;
  end if;

  -- At most one newest eligible and one completed row per version. Reuse the
  -- established workspace/learner/status and version/workspace indexes.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'workspace_id',a.workspace_id,'learner_id',a.learner_id,'quiz_version_id',a.quiz_version_id,
    'status',a.status,'available_at',a.available_at,'due_at',a.due_at,'created_at',a.created_at
  ) order by a.created_at,a.id),'[]'::jsonb) into v_assignments
  from unnest(v_versions) version_id
  cross join (values(false),(true)) completed(is_completed)
  cross join lateral (
    select a.* from public.quiz_assignments a
    where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and a.quiz_version_id=version_id
      and case when completed.is_completed then a.status='completed' and exists(
        select 1 from public.quiz_attempts t where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id
          and t.quiz_version_id=version_id and t.status='submitted' and t.delivery_mode in ('learning','exam')
      ) else a.status in ('assigned','in_progress') and (a.available_at is null or a.available_at<=v_now) and (a.due_at is null or a.due_at>=v_now) end
    order by a.created_at desc,a.id desc limit 1
  ) a;

  if p_version_ids is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'workspace_id',t.workspace_id,'learner_id',t.learner_id,'quiz_version_id',t.quiz_version_id,
      'status',t.status,'delivery_mode',t.delivery_mode,'started_at',t.started_at,'submitted_at',t.submitted_at,
      'paper_model_code',t.metadata->>'paper_model_code'
    ) order by t.quiz_version_id,t.delivery_mode,t.status),'[]'::jsonb) into v_attempts
    from unnest(v_versions) version_id
    cross join (values('learning','in_progress'),('learning','submitted'),('exam','in_progress'),('exam','submitted')) modes(delivery_mode,status)
    cross join lateral (
      select t.* from public.quiz_attempts t
      where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id and t.quiz_version_id=version_id
        and t.delivery_mode=modes.delivery_mode and t.status=modes.status
      order by coalesce(extract(epoch from case when modes.status='in_progress' then t.started_at else t.submitted_at end),0) desc,t.id desc limit 1
    ) t;
    -- An older official paper attempt must still prevent parallel Learning even
    -- when the newest Exam row is digital. Only its version identity is needed.
    select coalesce(jsonb_agg(version_id order by version_id),'[]'::jsonb) into v_paper_versions
    from unnest(v_versions) version_id where exists(
      select 1 from public.quiz_attempts t where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id
        and t.quiz_version_id=version_id and t.delivery_mode='exam' and t.status in ('in_progress','submitted')
        and btrim(coalesce(t.metadata->>'paper_model_code',''))<>''
    );
  end if;
  return jsonb_build_object('complete',true,'version_count',cardinality(v_versions),
    'attempts',v_attempts,'assignments',v_assignments,'paper_version_ids',v_paper_versions);
end $$;
revoke all on function public.flh_learner_journey_progress(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.flh_learner_journey_progress(uuid,uuid,uuid[]) to service_role;
comment on function public.flh_learner_journey_progress(uuid,uuid,uuid[]) is
  'FLH-024 v1.1: read-only own bounded version evidence; newest attempt per mode/status and compact eligible/completed assignments, no answer keys or history writes.';
