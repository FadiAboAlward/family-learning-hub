-- FLH-024 v1.1 / Drive revision 2: bounded transport, no global catalog cap.
-- Only the six version contexts that can affect the existing next action are
-- read. Published history stays immutable and does not grow the API payload.
create or replace function public.flh_learner_journey_context(
  p_workspace_id uuid, p_learner_id uuid, p_quiz_ids uuid[] default null,
  p_after_quiz_id uuid default null, p_page_size integer default 100
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_now timestamptz := statement_timestamp();
  v_quiz_ids uuid[];
  v_version_ids uuid[];
  v_versions jsonb;
  v_progress jsonb;
  v_has_more boolean := false;
begin
  if p_workspace_id is null or p_learner_id is null or p_page_size is null
    or p_page_size not between 1 and 100 or not exists(
      select 1 from public.learners l where l.workspace_id=p_workspace_id and l.id=p_learner_id and l.is_active
    ) then return jsonb_build_object('error','JOURNEY_UNAVAILABLE'); end if;
  if p_quiz_ids is null then
    -- Keyset discovery is confined to legitimate assignments, including completed
    -- assignments with an actual own result. Retakes/versions do not consume pages.
    select coalesce(array_agg(x.id order by x.id),'{}'::uuid[]) into v_quiz_ids from (
      select distinct q.id from public.quiz_assignments a
      join public.quiz_versions v on v.id=a.quiz_version_id and v.workspace_id=a.workspace_id and v.state='published'
      join public.quizzes q on q.id=v.quiz_id and q.workspace_id=v.workspace_id and q.status='active'
      where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id
        and (p_after_quiz_id is null or q.id>p_after_quiz_id) and (
          (a.status in('assigned','in_progress') and (a.available_at is null or a.available_at<=v_now) and (a.due_at is null or a.due_at>=v_now))
          or (a.status='completed' and exists(select 1 from public.quiz_attempts t
            where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id and t.quiz_version_id=a.quiz_version_id
              and t.status='submitted' and t.delivery_mode in('learning','exam')))
        ) order by q.id limit p_page_size+1
    ) x;
    v_has_more:=cardinality(v_quiz_ids)>p_page_size;
    v_quiz_ids:=v_quiz_ids[1:p_page_size];
  else
    if p_after_quiz_id is not null or cardinality(p_quiz_ids)>100 or array_position(p_quiz_ids,null) is not null then
      return jsonb_build_object('error','JOURNEY_UNAVAILABLE');
    end if;
    select coalesce(array_agg(q.id order by q.id),'{}'::uuid[]) into v_quiz_ids
      from public.quizzes q where q.workspace_id=p_workspace_id and q.status='active' and q.id=any(p_quiz_ids);
    if cardinality(v_quiz_ids)<>(select count(distinct id) from unnest(p_quiz_ids) id) then
      return jsonb_build_object('error','JOURNEY_UNAVAILABLE');
    end if;
  end if;
  v_quiz_ids:=coalesce(v_quiz_ids,'{}'::uuid[]);
  select coalesce(array_agg(distinct chosen.id),'{}'::uuid[]) into v_version_ids
  from unnest(v_quiz_ids) requested(quiz_id) cross join lateral (
    (select v.id from public.quiz_versions v where v.workspace_id=p_workspace_id and v.quiz_id=requested.quiz_id and v.state='published'
      order by v.version_no desc limit 1)
    union
    select active_version.id from (values('learning'),('exam')) modes(delivery_mode) cross join lateral (
      select v.id from public.quiz_attempts t join public.quiz_versions v on v.id=t.quiz_version_id and v.workspace_id=t.workspace_id
      where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id and v.quiz_id=requested.quiz_id and v.state='published'
        and t.status='in_progress' and t.delivery_mode=modes.delivery_mode
      order by coalesce(extract(epoch from t.started_at),0) desc,t.id desc limit 1
    ) active_version
    union
    (select v.id from public.quiz_assignments a join public.quiz_versions v on v.id=a.quiz_version_id and v.workspace_id=a.workspace_id
      where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and v.quiz_id=requested.quiz_id and v.state='published'
        and a.status in('assigned','in_progress') and (a.available_at is null or a.available_at<=v_now) and (a.due_at is null or a.due_at>=v_now)
      order by a.created_at desc,a.id desc limit 1)
    union
    (select v.id from public.quiz_attempts t join public.quiz_versions v on v.id=t.quiz_version_id and v.workspace_id=t.workspace_id
      where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id and v.quiz_id=requested.quiz_id and v.state='published'
        and t.status='submitted' and t.delivery_mode in('learning','exam')
      order by coalesce(extract(epoch from t.submitted_at),0) desc,t.id desc limit 1)
    union
    (select v.id from public.quiz_assignments a join public.quiz_versions v on v.id=a.quiz_version_id and v.workspace_id=a.workspace_id
      where a.workspace_id=p_workspace_id and a.learner_id=p_learner_id and v.quiz_id=requested.quiz_id and v.state='published' and a.status='completed'
        and exists(select 1 from public.quiz_attempts t where t.workspace_id=p_workspace_id and t.learner_id=p_learner_id
          and t.quiz_version_id=a.quiz_version_id and t.status='submitted' and t.delivery_mode in('learning','exam'))
      order by a.created_at desc,a.id desc limit 1)
  ) chosen;
  -- <=100 quizzes * <=6 versions fits the existing <=1000 per-call safety guard.
  -- Reuse exact mode/status/assignment and older-paper EXISTS evidence in the same
  -- STABLE statement snapshot; no answer content or history writes are introduced.
  v_progress:=public.flh_learner_journey_progress(p_workspace_id,p_learner_id,v_version_ids);
  if v_progress->>'complete' is distinct from 'true' then return jsonb_build_object('error','JOURNEY_UNAVAILABLE'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'workspace_id',v.workspace_id,'quiz_id',v.quiz_id,
    'version_no',v.version_no,'state',v.state,'support_source',v.settings->>'support_source') order by v.quiz_id,v.version_no),'[]'::jsonb)
    into v_versions from public.quiz_versions v where v.workspace_id=p_workspace_id and v.id=any(v_version_ids);
  return v_progress||jsonb_build_object('quiz_ids',v_quiz_ids,'quiz_count',cardinality(v_quiz_ids),'versions',v_versions,
    'has_more',v_has_more,'next_quiz_id',case when v_has_more then v_quiz_ids[cardinality(v_quiz_ids)] else null end);
end $$;
revoke all on function public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer) from public,anon,authenticated;
grant execute on function public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer) to service_role;
comment on function public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer) is
  'FLH-024 v1.1: service-only read-only paged assigned quiz discovery and six relevant version contexts per quiz, preserving immutable active/eligible/result/paper evidence.';
