-- FLH-FEAT-2026-020 v1.0
-- Exact-version paper ingestion contract for one official support session.
begin;

do $contract$
declare
  w uuid;
  l uuid;
  v uuid;
  slug text := 'tr-g5-meb-support-s2-decimals';
  request_one uuid := '73000000-0000-4000-8000-000000000001';
  request_two uuid := '73000000-0000-4000-8000-000000000002';
  r jsonb;
  retry jsonb;
  blocked jsonb;
  attempt_id uuid;
begin
  select id into strict w from public.workspaces where slug='family-learning-hub';
  select id into strict l
  from public.learners
  where workspace_id=w and slug='test' and is_active
    and coalesce((metadata->>'is_test')::boolean,false);

  if has_function_privilege('anon','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb)','EXECUTE') then
    raise exception 'SUPPORT_PAPER_ACL_INVALID';
  end if;

  select qv.id into strict v
  from public.quizzes q
  join public.quiz_versions qv on qv.workspace_id=q.workspace_id and qv.quiz_id=q.id and qv.state='published'
  where q.workspace_id=w and q.slug=slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false)
    and coalesce((qv.settings->>'support_source')::boolean,false)
  order by qv.version_no desc limit 1;

  set local role service_role;
  r:=public.flh_support_workbook_paper_ingest(w,l,v,slug,request_one,'{}'::jsonb);
  reset role;

  if coalesce((r->>'ok')::boolean,false) is not true
     or r->>'paper_ingested' is distinct from 'true'
     or (r->>'question_count')::integer<>8
     or (r->>'graded_count')::integer<>7
     or (r->>'ungraded_count')::integer<>1
     or (r->>'unanswered_count')::integer<>8
     or (r->>'max_points')::numeric<>7
     or (r->>'score_points')::numeric<>0
     or (r->>'percentage')::numeric<>0 then
    raise exception 'SUPPORT_PAPER_RESULT_INVALID:%',r;
  end if;

  attempt_id:=(r->>'attempt_id')::uuid;
  if not exists(
    select 1 from public.quiz_attempts
    where id=attempt_id and workspace_id=w and learner_id=l
      and status='submitted' and delivery_mode='learning'
      and metadata->>'engine'='support-paper-v1'
      and metadata->>'delivery_surface'='paper'
      and coalesce((metadata->>'paper_ingested')::boolean,false)
  ) then raise exception 'SUPPORT_PAPER_ATTEMPT_METADATA_INVALID'; end if;

  if (select count(*) from public.quiz_attempt_answers where attempt_id=attempt_id and response='{"support_unanswered":true}'::jsonb)<>8 then
    raise exception 'SUPPORT_PAPER_BLANK_REPRESENTATION_INVALID';
  end if;
  if exists(
    select 1 from public.quiz_attempt_answers
    where attempt_id=attempt_id and response='{"unanswered":true}'::jsonb
  ) then raise exception 'SUPPORT_PAPER_LEGACY_BLANK_REUSED'; end if;

  set local role service_role;
  retry:=public.flh_support_workbook_paper_ingest(w,l,v,slug,request_one,'{}'::jsonb);
  reset role;
  if retry<>r then raise exception 'SUPPORT_PAPER_IDEMPOTENT_RESULT_DRIFT'; end if;
  if (select count(*) from public.quiz_attempts where workspace_id=w and learner_id=l and quiz_version_id=v and status='submitted')<>1 then
    raise exception 'SUPPORT_PAPER_IDEMPOTENT_ATTEMPT_DUPLICATION';
  end if;

  set local role service_role;
  blocked:=public.flh_support_workbook_paper_ingest(w,l,v,slug,request_two,'{}'::jsonb);
  reset role;
  if blocked->>'error' is distinct from 'SESSION_ALREADY_COMPLETED' then
    raise exception 'SUPPORT_PAPER_SECOND_TRANSCRIPTION_NOT_BLOCKED:%',blocked;
  end if;

  -- A successful DO statement commits, so explicitly remove only this
  -- contract's attempt and mastery fixtures. Failures roll back the DO statement.
  delete from public.quiz_attempts
  where workspace_id=w and id=attempt_id;

  delete from public.learner_concept_mastery m
  where m.workspace_id=w
    and m.learner_id=l
    and m.metadata->>'engine'='support-paper-v1'
    and exists (
      select 1
      from public.quiz_question_concepts qc
      join public.quiz_questions q
        on q.workspace_id=qc.workspace_id and q.id=qc.question_id
      where qc.workspace_id=w
        and qc.concept_id=m.concept_id
        and q.quiz_version_id=v
    );
end;
$contract$;
