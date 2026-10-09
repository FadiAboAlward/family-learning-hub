-- FLH-024 v1.1 / Drive revision 2. Disposable Runner-local database only.
-- Exact synthetic history and assignments roll back; no real learner data copied.
do $contract$
declare
  w constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  other_w constant uuid := '9a240000-0000-4000-8000-000000000001';
  sibling constant uuid := '9a240000-0000-4000-8000-000000000002';
  other_learner constant uuid := '9a240000-0000-4000-8000-000000000003';
  q constant uuid := '9a240000-0000-4000-8000-000000000004';
  old_v constant uuid := '9a240000-0000-4000-8000-000000000005';
  new_v constant uuid := '9a240000-0000-4000-8000-000000000006';
  future_v constant uuid := '9a240000-0000-4000-8000-000000000007';
  expired_v constant uuid := '9a240000-0000-4000-8000-000000000008';
  other_q constant uuid := '9a240000-0000-4000-8000-000000000009';
  other_v constant uuid := '9a240000-0000-4000-8000-000000000010';
  active_id constant uuid := '9a240000-0000-4000-8000-000000000011';
  result_id constant uuid := '9a240000-0000-4000-8000-000000000012';
  paper_id uuid;
  paper_version uuid;
  paper_model text;
  paper_assignment uuid;
  paper_started jsonb;
  paper_latest constant uuid := '9a240000-0000-4000-8000-000000000013';
  l uuid; subject_id bigint; result jsonb; discovery jsonb; original_history jsonb; original_assignments jsonb; original_state jsonb;
  bounded_ids uuid[]; failed boolean;
  eligible_v constant uuid := '9a240000-0000-4000-8000-000000000014';
  completed_v constant uuid := '9a240000-0000-4000-8000-000000000015';
  active_exam_id constant uuid := '9a240000-0000-4000-8000-000000000016';
  latest_result_id constant uuid := '9a240000-0000-4000-8000-000000000017';
  completed_result_id constant uuid := '9a240000-0000-4000-8000-000000000018';
  completed_q constant uuid := '9a240000-0000-4000-8000-000000000019';
  completed_q_old_v constant uuid := '9a240000-0000-4000-8000-000000000020';
  completed_q_new_v constant uuid := '9a240000-0000-4000-8000-000000000021';
  cancelled_q constant uuid := '9a240000-0000-4000-8000-000000000022';
  unpublished_q constant uuid := '9a240000-0000-4000-8000-000000000023';
  inactive_q constant uuid := '9a240000-0000-4000-8000-000000000024';
  future_only_q constant uuid := '9a240000-0000-4000-8000-000000000025';
  expired_only_q constant uuid := '9a240000-0000-4000-8000-000000000026';
  sibling_result_q constant uuid := '9a240000-0000-4000-8000-000000000027';
  context jsonb; paper_quiz uuid; expected_versions uuid[]; selected_versions uuid[];
  scale_quiz_ids uuid[]; page_ids uuid[]; seen_quiz_ids uuid[] := '{}'::uuid[];
  cursor_id uuid; next_id uuid; page_number integer := 0; batch_start integer; explicit_seen integer := 0;
  context_history jsonb; context_assignments jsonb;
begin
  execute $def$create or replace function pg_temp.journey_assert(ok boolean,msg text) returns void
    language plpgsql as $body$begin if ok is distinct from true then raise exception 'Journey progress contract: %',msg; end if; end$body$$def$;
  select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and coalesce((metadata->>'is_test')::boolean,false);
  select coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}'::jsonb) into original_history from public.quiz_attempts t where t.workspace_id=w and t.learner_id=l;
  select coalesce(jsonb_object_agg(a.id::text,md5(to_jsonb(a)::text)),'{}'::jsonb) into original_assignments from public.quiz_assignments a where a.workspace_id=w and a.learner_id=l;
  select to_jsonb(s) into original_state from public.learner_gamification_state s where s.workspace_id=w and s.learner_id=l;
  begin
    perform pg_temp.journey_assert(not has_function_privilege('anon','public.flh_learner_journey_progress(uuid,uuid,uuid[])','EXECUTE')
      and not has_function_privilege('authenticated','public.flh_learner_journey_progress(uuid,uuid,uuid[])','EXECUTE')
      and has_function_privilege('service_role','public.flh_learner_journey_progress(uuid,uuid,uuid[])','EXECUTE'),'only verified service boundary may read journey evidence');
    perform pg_temp.journey_assert((select provolatile='s' and not prosecdef and 'search_path=""'=any(proconfig)
      from pg_proc where oid='public.flh_learner_journey_progress(uuid,uuid,uuid[])'::regprocedure),'read-only STABLE invoker and fixed empty search path');
    insert into public.subjects(code,name_ar,name_en) values('qa-journey-compact-progress','اختبار رحلة اصطناعية','Synthetic journey progress') returning id into subject_id;
    insert into public.workspaces(id,name,slug) values(other_w,'QA journey foreign workspace','qa-journey-foreign');
    insert into public.learners(id,workspace_id,display_name,slug,metadata) values
      (sibling,w,'QA synthetic sibling','qa-journey-sibling','{"is_test":true,"exclude_from_parent_metrics":true}'),
      (other_learner,other_w,'QA synthetic foreign learner','qa-journey-foreign','{"is_test":true,"exclude_from_parent_metrics":true}');
    insert into public.quizzes(id,workspace_id,subject_id,slug,title,status) values
      (q,w,subject_id,'qa-journey-compact','Synthetic compact journey','active'),
      (other_q,other_w,subject_id,'qa-journey-foreign','Synthetic foreign journey','active');
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values
      (old_v,w,q,1,'published'),(new_v,w,q,2,'published'),(future_v,w,q,3,'published'),(expired_v,w,q,4,'published'),(other_v,other_w,other_q,1,'published');
    -- 1001 retakes exceed the old raw-history transport cap but need one summary.
    insert into public.quiz_attempts(workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at,metadata)
      select w,l,old_v,'submitted','learning','2020-01-01T00:00:00Z'::timestamptz+i*interval '1 second',
        '2020-01-01T00:01:00Z'::timestamptz+i*interval '1 second','{"private_sentinel":"PRIVATE_JOURNEY_METADATA"}'::jsonb from generate_series(1,1001) i;
    insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at,metadata) values
      (active_id,w,l,old_v,'in_progress','learning','2020-02-01T00:00:00Z',null,'{}'),
      (result_id,w,l,old_v,'submitted','exam','2020-02-02T00:00:00Z','2020-02-02T01:00:00Z','{"private_sentinel":"PRIVATE_JOURNEY_METADATA"}');
    insert into public.quiz_attempts(workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at) values
      (w,sibling,old_v,'in_progress','learning',now(),null),(w,sibling,new_v,'submitted','exam',now()-interval '1 minute',now()),
      (other_w,other_learner,other_v,'submitted','exam',now()-interval '1 minute',now());
    -- Completed history is compacted too; a sibling's result never proves ours.
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,created_at)
      select w,l,old_v,'completed','2020-01-01T00:00:00Z'::timestamptz+i*interval '1 second' from generate_series(1,1001) i;
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,due_at) values
      (w,l,old_v,'assigned',null,null),(w,l,new_v,'completed',null,null),
      (w,l,future_v,'assigned',now()+interval '1 day',null),(w,l,expired_v,'assigned',null,now()-interval '1 day');
    execute 'set local role service_role';
    discovery:=public.flh_learner_journey_progress(w,l,null);
    execute 'reset role';
    -- Reuse the canonical vetted support-paper fixture/start pattern. Submitted
    -- paper rows cannot be fabricated: they require evaluated answers and the
    -- ingestion gate. A genuine validated in-progress paper queue is sufficient
    -- for the existing paper-evidence boundary exercised by this read contract.
    select v.id,v.settings->'paper_exam'->>'paper_model_code' into strict paper_version,paper_model
    from public.quizzes quiz join public.quiz_versions v on v.workspace_id=quiz.workspace_id and v.quiz_id=quiz.id and v.state='published'
    where quiz.workspace_id=w and quiz.slug='tr-g5-meb-support-s2-decimals'
      and coalesce((quiz.delivery_config->>'support_session')::boolean,false)
      and coalesce((v.settings->>'support_source')::boolean,false)
    order by v.version_no desc limit 1;
    perform pg_temp.journey_assert(nullif(paper_model,'') is not null and not exists(
      select 1 from public.quiz_attempts t where t.workspace_id=w and t.learner_id=l and t.quiz_version_id=paper_version and t.status in('in_progress','submitted')
    ),'fresh disposable paper fixture has no pre-existing learner attempt');
    -- Canonical start still requires ordinary authorized assignment/program access.
    -- Reuse the paper contract's bounded Testing assignment setup; rollback below
    -- restores any pre-existing Testing assignment byte-for-byte.
    select a.id into paper_assignment from public.quiz_assignments a
      where a.workspace_id=w and a.learner_id=l and a.quiz_version_id=paper_version and a.status in('assigned','in_progress')
      order by a.created_at desc limit 1;
    if paper_assignment is null then
      insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,metadata)
        values(w,l,paper_version,'assigned',now(),'{"contract_fixture":"qa_journey_compact_progress"}') returning id into paper_assignment;
    else
      update public.quiz_assignments set available_at=now(),due_at=null where id=paper_assignment and workspace_id=w and learner_id=l;
    end if;
    execute 'set local role service_role';
    paper_started:=public.flh_paper_exam_start(w,l,paper_version,paper_model,'qa_journey_compact_progress');
    execute 'reset role';
    perform pg_temp.journey_assert(paper_started->>'ok'='true' and paper_started->>'resumed'='false','canonical paper start creates its owned synthetic validated queue');
    paper_id:=(paper_started->>'attempt_id')::uuid;
    perform pg_temp.journey_assert(public.flh_paper_exam_validate_queue(w,paper_id)->>'ok'='true'
      and(select status='in_progress' and coalesce((metadata->>'paper_queue_validated')::boolean,false) from public.quiz_attempts where id=paper_id),'canonical paper validator approves the fixture without bypass');
    update public.quiz_attempts set started_at='2020-01-02T00:00:00Z' where id=paper_id and workspace_id=w and learner_id=l;
    -- Synthetic legacy overlap: the latest digital row shares the paper row's
    -- mode/status bucket. The read must not erase the older verified paper fact.
    insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,metadata)
      values(paper_latest,w,l,paper_version,'in_progress','exam','2020-02-02T00:00:00Z','{"private_sentinel":"PRIVATE_JOURNEY_METADATA"}');
    execute 'set local role service_role';
    result:=public.flh_learner_journey_progress(w,l,array[old_v,new_v,future_v,expired_v,paper_version]);
    execute 'reset role';
    perform pg_temp.journey_assert(discovery->>'complete'='true' and(discovery->>'version_count')::integer=1
      and jsonb_array_length(discovery->'assignments')=2 and discovery->'attempts'='[]'::jsonb,'large completed history plus eligible old assignment is bounded and does not expose history');
    perform pg_temp.journey_assert(result->>'complete'='true' and(result->>'version_count')::integer=5
      and jsonb_array_length(result->'attempts')=4 and jsonb_array_length(result->'assignments')=3,'1001 retakes collapse to relevant mode/status rows with exact requested published context');
    perform pg_temp.journey_assert(exists(select 1 from jsonb_array_elements(result->'attempts') a where a->>'id'=active_id::text and a->>'quiz_version_id'=old_v::text)
      and exists(select 1 from jsonb_array_elements(result->'attempts') a where a->>'id'=result_id::text)
      and exists(select 1 from jsonb_array_elements(result->'attempts') a where a->>'id'=paper_latest::text)
      and not exists(select 1 from jsonb_array_elements(result->'attempts') a where a->>'id'=paper_id::text),'old immutable active version and newest digital submitted result retained');
    perform pg_temp.journey_assert(result->'paper_version_ids'=jsonb_build_array(paper_version),'older official paper evidence survives newer digital projection');
    perform pg_temp.journey_assert(not exists(select 1 from jsonb_array_elements(result->'attempts') a where a->>'workspace_id'<>w::text or a->>'learner_id'<>l::text)
      and not exists(select 1 from jsonb_array_elements(result->'assignments') a where a->>'quiz_version_id' in(new_v::text,future_v::text,expired_v::text,other_v::text))
      and result::text not like '%PRIVATE_JOURNEY_METADATA%' and result::text not like '%correct_answer%' and result::text not like '%score_points%','self/workspace/date boundaries and safe projection');
    perform pg_temp.journey_assert(public.flh_learner_journey_progress(other_w,l,array[other_v])->>'error'='JOURNEY_UNAVAILABLE','foreign workspace cannot read canonical learner');
    perform pg_temp.journey_assert(public.flh_learner_journey_progress(w,l,array[old_v,other_v])->>'error'='JOURNEY_UNAVAILABLE','unknown/foreign requested version cannot produce a falsely complete carrier');
    failed:=false;execute 'set local role authenticated';
    begin perform public.flh_learner_journey_progress(w,l,array[old_v]);exception when insufficient_privilege then failed:=true;end;
    execute 'reset role';perform pg_temp.journey_assert(failed,'actual authenticated direct RPC is denied');
    perform pg_temp.journey_assert((select coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}'::jsonb) from public.quiz_attempts t where original_history?t.id::text)=original_history
      and (select to_jsonb(s) from public.learner_gamification_state s where s.workspace_id=w and s.learner_id=l) is not distinct from original_state,'summary reads never mutate prior history or wallet');
    -- A large distinct-version catalog still fails closed; it is not silently cut.
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
      select md5('qa-journey-bound-'||i)::uuid,w,q,100+i,'published' from generate_series(1,1001) i;
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status)
      select w,l,md5('qa-journey-bound-'||i)::uuid,'assigned' from generate_series(1,1001) i;
    select array_agg(md5('qa-journey-bound-'||i)::uuid) into bounded_ids from generate_series(1,1001) i;
    perform pg_temp.journey_assert(public.flh_learner_journey_progress(w,l,null)->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_progress(w,l,bounded_ids)->>'error'='JOURNEY_UNAVAILABLE','distinct-version overflow is explicit for discovery and requested context');
    result:=public.flh_learner_journey_progress(w,l,bounded_ids[1:1000]);
    perform pg_temp.journey_assert(result->>'complete'='true' and(result->>'version_count')::integer=1000
      and jsonb_array_length(result->'assignments')=1000 and result->'attempts'='[]'::jsonb,'exact version-budget boundary returns a complete carrier');

    -- The context layer pages quiz identities before the old per-call version
    -- guard. One quiz with 1001 publications must never be globally unavailable.
    perform pg_temp.journey_assert(not has_function_privilege('anon','public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer)','EXECUTE')
      and not has_function_privilege('authenticated','public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer)','EXECUTE')
      and has_function_privilege('service_role','public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer)','EXECUTE'),'only verified service boundary may read paged context');
    perform pg_temp.journey_assert((select provolatile='s' and not prosecdef and 'search_path=""'=any(proconfig)
      from pg_proc where oid='public.flh_learner_journey_context(uuid,uuid,uuid[],uuid,integer)'::regprocedure),'context is STABLE invoker with a fixed empty search path');
    -- Make every one of the six carrier reasons distinct. The newest submitted
    -- result differs from the completed-assignment result on purpose.
    update public.quiz_assignments set created_at='2020-01-01T00:00:00Z'
      where workspace_id=w and learner_id=l
        and (quiz_version_id=any(bounded_ids) or quiz_version_id in(old_v,new_v,future_v,expired_v));
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values
      (eligible_v,w,q,5,'published'),(completed_v,w,q,6,'published');
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,created_at) values
      (w,l,eligible_v,'assigned','2025-01-01T00:00:00Z'),(w,l,completed_v,'completed','2025-01-02T00:00:00Z');
    insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at,metadata) values
      (active_exam_id,w,l,new_v,'in_progress','exam','2025-01-03T00:00:00Z',null,'{}'),
      (latest_result_id,w,l,expired_v,'submitted','exam','2025-01-04T00:00:00Z','2025-01-04T01:00:00Z','{"private_sentinel":"PRIVATE_JOURNEY_CONTEXT_METADATA"}'),
      (completed_result_id,w,l,completed_v,'submitted','learning','2024-01-01T00:00:00Z','2024-01-01T01:00:00Z','{}');
    expected_versions:=array[md5('qa-journey-bound-1001')::uuid,old_v,new_v,eligible_v,expired_v,completed_v];
    execute 'set local role service_role';
    context:=public.flh_learner_journey_context(w,l,array[q]);
    execute 'reset role';
    select array_agg((v->>'id')::uuid order by (v->>'id')::uuid) into selected_versions from jsonb_array_elements(context->'versions') v;
    perform pg_temp.journey_assert((select count(*)>1000 from public.quiz_versions v where v.workspace_id=w and v.quiz_id=q and v.state='published')
      and context->>'complete'='true' and(context->>'quiz_count')::integer=1 and(context->>'version_count')::integer=6
      and selected_versions@>expected_versions and expected_versions@>selected_versions
      and context->'quiz_ids'=jsonb_build_array(q) and context->>'has_more'='false' and context->'next_quiz_id'='null'::jsonb,
      '1001 published versions become exactly six relevant carriers, with no global publication cap');
    perform pg_temp.journey_assert(exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=active_id::text)
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=active_exam_id::text)
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=latest_result_id::text)
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=completed_result_id::text)
      and exists(select 1 from jsonb_array_elements(context->'assignments') a where a->>'quiz_version_id'=completed_v::text and a->>'status'='completed'),
      'active immutable modes and completed-assignment own result survive a newer result on another version');
    perform pg_temp.journey_assert(not exists(select 1 from jsonb_array_elements(context->'versions') v
      where v->>'workspace_id'<>w::text or v->>'quiz_id'<>q::text or v->>'state'<>'published'
        or exists(select 1 from jsonb_object_keys(v) key where key not in('id','workspace_id','quiz_id','version_no','state','support_source')))
      and context::text not like '%PRIVATE_JOURNEY_CONTEXT_METADATA%' and context::text not like '%correct_answer%' and context::text not like '%score_points%',
      'context publishes only safe version metadata and compact evidence');
    select v.quiz_id into strict paper_quiz from public.quiz_versions v where v.id=paper_version and v.workspace_id=w;
    execute 'set local role service_role';
    context:=public.flh_learner_journey_context(w,l,array[paper_quiz]);
    execute 'reset role';
    perform pg_temp.journey_assert(context->>'complete'='true' and context->'paper_version_ids'=jsonb_build_array(paper_version)
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=paper_latest::text)
      and not exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'id'=paper_id::text),
      'paged context retains older validated paper evidence despite the newest digital attempt');

    -- A bookless completed assignment still needs its own result version even
    -- though this same quiz has a later result with no completed assignment.
    insert into public.quizzes(id,workspace_id,subject_id,slug,title,status) values
      (completed_q,w,subject_id,'qa-journey-completed-context','Synthetic completed context','active'),
      (cancelled_q,w,subject_id,'qa-journey-cancelled-context','Synthetic revoked context','active'),
      (unpublished_q,w,subject_id,'qa-journey-unpublished-context','Synthetic unpublished context','active'),
      (inactive_q,w,subject_id,'qa-journey-inactive-context','Synthetic archived context','archived'),
      (future_only_q,w,subject_id,'qa-journey-future-context','Synthetic future context','active'),
      (expired_only_q,w,subject_id,'qa-journey-expired-context','Synthetic expired context','active'),
      (sibling_result_q,w,subject_id,'qa-journey-sibling-result-context','Synthetic sibling result context','active');
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values
      (completed_q_old_v,w,completed_q,1,'published'),(completed_q_new_v,w,completed_q,2,'published');
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
      select md5('qa-journey-context-version-'||quiz.id)::uuid,w,quiz.id,1,case when quiz.id=unpublished_q then 'draft' else 'published' end
      from public.quizzes quiz where quiz.id in(cancelled_q,unpublished_q,inactive_q,future_only_q,expired_only_q,sibling_result_q);
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,created_at) values
      (w,l,completed_q_old_v,'completed','2025-01-01T00:00:00Z');
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,due_at)
      select w,l,v.id,case when v.quiz_id=cancelled_q then 'cancelled' when v.quiz_id=sibling_result_q then 'completed' else 'assigned' end,
        case when v.quiz_id=future_only_q then now()+interval '1 day' else null end,
        case when v.quiz_id=expired_only_q then now()-interval '1 day' else null end
      from public.quiz_versions v where v.quiz_id in(cancelled_q,unpublished_q,inactive_q,future_only_q,expired_only_q,sibling_result_q);
    insert into public.quiz_attempts(workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,submitted_at) values
      (w,l,completed_q_old_v,'submitted','exam','2024-01-01T00:00:00Z','2024-01-01T01:00:00Z'),
      (w,l,completed_q_new_v,'submitted','exam','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z'),
      (w,l,md5('qa-journey-context-version-'||cancelled_q)::uuid,'in_progress','learning','2025-01-01T00:00:00Z',null),
      (w,sibling,md5('qa-journey-context-version-'||sibling_result_q)::uuid,'submitted','exam','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z');
    execute 'set local role service_role';
    context:=public.flh_learner_journey_context(w,l,array[completed_q]);
    execute 'reset role';
    perform pg_temp.journey_assert(context->>'complete'='true' and(context->>'version_count')::integer=2
      and exists(select 1 from jsonb_array_elements(context->'assignments') a where a->>'quiz_version_id'=completed_q_old_v::text and a->>'status'='completed')
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'quiz_version_id'=completed_q_old_v::text and a->>'status'='submitted')
      and exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'quiz_version_id'=completed_q_new_v::text and a->>'status'='submitted'),
      'completed standalone assignment carries its own submitted version independently of the latest result');
    execute 'set local role service_role';
    context:=public.flh_learner_journey_context(w,l,array[cancelled_q]);
    execute 'reset role';
    perform pg_temp.journey_assert(context->>'complete'='true' and jsonb_array_length(context->'attempts')=1 and context->'assignments'='[]'::jsonb,
      'revoked access retains an own immutable active version but invents no eligible assignment');
    context:=public.flh_learner_journey_context(w,l,array[unpublished_q]);
    perform pg_temp.journey_assert(context->>'complete'='true' and(context->>'quiz_count')::integer=1 and(context->>'version_count')::integer=0
      and context->'quiz_ids'=jsonb_build_array(unpublished_q) and context->'versions'='[]'::jsonb
      and context->'attempts'='[]'::jsonb and context->'assignments'='[]'::jsonb and context->'paper_version_ids'='[]'::jsonb,
      'explicit active unpublished quiz remains a complete empty publication context');
    context:=public.flh_learner_journey_context(w,l,'{}'::uuid[]);
    perform pg_temp.journey_assert(context->>'complete'='true' and(context->>'quiz_count')::integer=0 and(context->>'version_count')::integer=0
      and context->'quiz_ids'='[]'::jsonb and context->'versions'='[]'::jsonb and context->'attempts'='[]'::jsonb
      and context->'assignments'='[]'::jsonb and context->'paper_version_ids'='[]'::jsonb
      and context->>'has_more'='false' and context->'next_quiz_id'='null'::jsonb,'empty explicit context is honest and complete');
    context:=public.flh_learner_journey_context(w,l,null,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,100);
    perform pg_temp.journey_assert(context->>'complete'='true' and(context->>'quiz_count')::integer=0 and(context->>'version_count')::integer=0
      and context->'quiz_ids'='[]'::jsonb and context->'versions'='[]'::jsonb and context->'attempts'='[]'::jsonb
      and context->'assignments'='[]'::jsonb and context->'paper_version_ids'='[]'::jsonb
      and context->>'has_more'='false' and context->'next_quiz_id'='null'::jsonb,'discovery after the maximum UUID is a complete empty final page');
    perform pg_temp.journey_assert(public.flh_learner_journey_context(other_w,l,array[other_q])->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,array[other_q])->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,array[inactive_q])->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,array[md5('qa-journey-unknown-context')::uuid])->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,array[null]::uuid[])->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,array[q],q)->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,null,null,0)->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,null,null,101)->>'error'='JOURNEY_UNAVAILABLE'
      and public.flh_learner_journey_context(w,l,null,null,null)->>'error'='JOURNEY_UNAVAILABLE',
      'scope, unknown/inactive quizzes, null IDs, incompatible cursor and page bounds fail closed');
    failed:=false;execute 'set local role authenticated';
    begin perform public.flh_learner_journey_context(w,l,array[q]);exception when insufficient_privilege then failed:=true;end;
    execute 'reset role';perform pg_temp.journey_assert(failed,'actual authenticated direct context RPC is denied');

    -- More than 1000 legitimately assigned quizzes must be complete over UUID
    -- keyset pages and explicit chunks, not silently truncated or rejected.
    insert into public.quizzes(id,workspace_id,subject_id,slug,title,status)
      select md5('qa-journey-scale-quiz-'||i)::uuid,w,subject_id,'qa-journey-scale-'||i,'Synthetic paged journey '||i,'active'
      from generate_series(1,1001) i;
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
      select md5('qa-journey-scale-version-'||i)::uuid,w,md5('qa-journey-scale-quiz-'||i)::uuid,1,'published'
      from generate_series(1,1001) i;
    insert into public.quiz_assignments(id,workspace_id,learner_id,quiz_version_id,status,metadata)
      select md5('qa-journey-scale-assignment-'||i)::uuid,w,l,md5('qa-journey-scale-version-'||i)::uuid,'assigned',
        '{"contract_fixture":"qa_journey_paged_context"}'::jsonb from generate_series(1,1001) i;
    select array_agg(md5('qa-journey-scale-quiz-'||i)::uuid order by md5('qa-journey-scale-quiz-'||i)::uuid) into scale_quiz_ids from generate_series(1,1001) i;
    perform pg_temp.journey_assert(public.flh_learner_journey_context(w,l,scale_quiz_ids[1:101])->>'error'='JOURNEY_UNAVAILABLE',
      'oversized explicit request fails while callers can page the whole catalog');
    select coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}'::jsonb) into context_history from public.quiz_attempts t where t.workspace_id=w and t.learner_id=l;
    select coalesce(jsonb_object_agg(a.id::text,md5(to_jsonb(a)::text)),'{}'::jsonb) into context_assignments from public.quiz_assignments a where a.workspace_id=w and a.learner_id=l;
    cursor_id:=null;
    loop
      page_number:=page_number+1;
      perform pg_temp.journey_assert(page_number<=100,'keyset discovery terminates without a repeated or unbounded cursor');
      execute 'set local role service_role';
      context:=public.flh_learner_journey_context(w,l,null,cursor_id,100);
      execute 'reset role';
      select coalesce(array_agg(id order by ordinal),'{}'::uuid[]) into page_ids
        from jsonb_array_elements_text(context->'quiz_ids') with ordinality ids(value,ordinal)
        cross join lateral (select value::uuid id) cast_id;
      perform pg_temp.journey_assert(context->>'complete'='true' and(context->>'quiz_count')::integer=cardinality(page_ids)
        and cardinality(page_ids)<=100 and(context->>'version_count')::integer=jsonb_array_length(context->'versions')
        and(context->>'version_count')::integer<=6*cardinality(page_ids)
        and jsonb_array_length(context->'attempts')<=(context->>'version_count')::integer*4
        and jsonb_array_length(context->'assignments')<=(context->>'version_count')::integer*2
        and jsonb_array_length(context->'paper_version_ids')<=(context->>'version_count')::integer,
        'every discovery page reports complete bounded quiz/version/mode evidence');
      perform pg_temp.journey_assert(not exists(select 1 from unnest(page_ids) id where id=any(seen_quiz_ids) or (cursor_id is not null and id<=cursor_id))
        and page_ids=(select coalesce(array_agg(id order by id),'{}'::uuid[]) from unnest(page_ids) id)
        and cardinality(page_ids)=(select count(distinct id) from unnest(page_ids) id),
        'UUID keyset pages are sorted, duplicate-free and strictly advance');
      perform pg_temp.journey_assert(not exists(select 1 from unnest(page_ids) id where id in(cancelled_q,unpublished_q,inactive_q,future_only_q,expired_only_q,sibling_result_q,other_q))
        and not exists(select 1 from jsonb_array_elements(context->'versions') v where not ((v->>'quiz_id')::uuid=any(page_ids)) or v->>'workspace_id'<>w::text or v->>'state'<>'published')
        and not exists(select 1 from jsonb_array_elements(context->'versions') v group by v->>'quiz_id' having count(*)>6)
        and not exists(select 1 from jsonb_array_elements(context->'attempts') a where a->>'workspace_id'<>w::text or a->>'learner_id'<>l::text)
        and not exists(select 1 from jsonb_array_elements(context->'assignments') a where a->>'workspace_id'<>w::text or a->>'learner_id'<>l::text),
        'discovery excludes unavailable, cancelled, unpublished, inactive, sibling-only and foreign evidence');
      seen_quiz_ids:=seen_quiz_ids||page_ids;
      if context->>'has_more'='true' then
        next_id:=(context->>'next_quiz_id')::uuid;
        perform pg_temp.journey_assert(cardinality(page_ids)=100 and next_id=page_ids[cardinality(page_ids)]
          and (cursor_id is null or next_id>cursor_id),'nonfinal page cursor is the last returned quiz and advances');
        cursor_id:=next_id;
      else
        perform pg_temp.journey_assert(context->>'has_more'='false' and context->'next_quiz_id'='null'::jsonb,'final discovery page has no cursor');
        exit;
      end if;
    end loop;
    perform pg_temp.journey_assert(cardinality(seen_quiz_ids)>1000 and seen_quiz_ids@>scale_quiz_ids
      and completed_q=any(seen_quiz_ids) and q=any(seen_quiz_ids) and page_number>=11,
      'all 1001 legitimate activities plus own completed standalone assignment appear across discovery pages');
    for batch_start in 1..cardinality(scale_quiz_ids) by 100 loop
      page_ids:=scale_quiz_ids[batch_start:least(batch_start+99,cardinality(scale_quiz_ids))];
      execute 'set local role service_role';
      context:=public.flh_learner_journey_context(w,l,page_ids);
      execute 'reset role';
      perform pg_temp.journey_assert(context->>'complete'='true' and context->'quiz_ids'=to_jsonb(page_ids)
        and(context->>'quiz_count')::integer=cardinality(page_ids) and(context->>'version_count')::integer=cardinality(page_ids)
        and jsonb_array_length(context->'versions')=cardinality(page_ids) and jsonb_array_length(context->'assignments')=cardinality(page_ids)
        and context->'attempts'='[]'::jsonb and context->'paper_version_ids'='[]'::jsonb
        and context->>'has_more'='false' and context->'next_quiz_id'='null'::jsonb,
        'each explicit visible-catalog chunk is complete with every assigned publication and no fabricated attempt');
      explicit_seen:=explicit_seen+cardinality(page_ids);
    end loop;
    perform pg_temp.journey_assert(explicit_seen=1001,'explicit chunks cover all 1001 visible quizzes');
    perform pg_temp.journey_assert((select coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}'::jsonb) from public.quiz_attempts t where t.workspace_id=w and t.learner_id=l)=context_history
      and(select coalesce(jsonb_object_agg(a.id::text,md5(to_jsonb(a)::text)),'{}'::jsonb) from public.quiz_assignments a where a.workspace_id=w and a.learner_id=l)=context_assignments
      and(select to_jsonb(s) from public.learner_gamification_state s where s.workspace_id=w and s.learner_id=l) is not distinct from original_state,
      'all context/discovery/chunk reads preserve every existing and synthetic history, assignment and wallet row');
    raise exception 'Successful journey progress rollback' using errcode='ZX024';
  exception when sqlstate 'ZX024' then null;
  end;
  perform pg_temp.journey_assert((select coalesce(jsonb_object_agg(t.id::text,md5(to_jsonb(t)::text)),'{}'::jsonb) from public.quiz_attempts t where t.workspace_id=w and t.learner_id=l)=original_history
    and(select coalesce(jsonb_object_agg(a.id::text,md5(to_jsonb(a)::text)),'{}'::jsonb) from public.quiz_assignments a where a.workspace_id=w and a.learner_id=l)=original_assignments
    and not exists(select 1 from public.quiz_attempt_question_queue where quiz_attempt_id in(paper_id,paper_latest))
    and not exists(select 1 from public.quizzes where id in(q,other_q))
    and not exists(select 1 from public.quizzes where slug like 'qa-journey-scale-%' or id in(completed_q,cancelled_q,unpublished_q,inactive_q,future_only_q,expired_only_q,sibling_result_q))
    and not exists(select 1 from public.quiz_versions where id in(eligible_v,completed_v) or id=any(bounded_ids))
    and not exists(select 1 from public.quiz_assignments where metadata->>'contract_fixture'='qa_journey_paged_context')
    and not exists(select 1 from public.learners where id in(sibling,other_learner))
    and not exists(select 1 from public.workspaces where id=other_w)
    and not exists(select 1 from public.subjects where code='qa-journey-compact-progress'),'all synthetic histories/catalog/identity fixtures roll back');
  raise notice 'Compact journey progress scale, authority and immutable evidence contract passed; all fixtures rolled back';
end $contract$;
