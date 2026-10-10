-- FLH024 v1.1 rev2 / child FLH022 v1.1 rev3 authored-outcomes contract.
-- Disposable isolated database only. Synthetic Testing fixtures always roll back.
do $contract$
declare
  w uuid; l uuid; owner_id uuid:=gen_random_uuid(); teacher_id uuid:=gen_random_uuid(); other_l uuid:=gen_random_uuid();
  curriculum uuid:=gen_random_uuid(); program uuid:=gen_random_uuid(); quiz uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
  concept_one uuid:=gen_random_uuid(); concept_two uuid:=gen_random_uuid(); question_one uuid:=gen_random_uuid(); question_two uuid:=gen_random_uuid();
  subject bigint; base jsonb; reviewed jsonb; candidate jsonb; invalid_json jsonb; invalid_array text[];
  result jsonb; resumed jsonb; preview jsonb; frozen jsonb; academic_before jsonb; snapshots_before jsonb;
  attempt uuid; assignment_one uuid; assignment_two uuid; video_one uuid; video_two uuid; previous_video uuid; current_video uuid; status_token uuid;
begin
  execute $definition$create or replace function pg_temp.outcomes_assert(ok boolean,message text)
    returns void language plpgsql as $assert$begin
      if ok is distinct from true then raise exception 'Optional video outcomes contract: %',message; end if;
    end$assert$$definition$;
  execute $definition$create or replace function pg_temp.outcomes_academic_state(w uuid,l uuid)
    returns jsonb language plpgsql as $state$
    declare table_name text; predicate text; rows jsonb; result jsonb:='{}'::jsonb;
    begin
      foreach table_name in array array['quiz_attempts','quiz_attempt_answers','quiz_answer_attempts','quiz_attempt_question_queue',
        'learner_concept_mastery','adaptive_events','learner_gamification_state','gamification_events','learners'] loop
        if table_name='learners' then predicate:='r.id=$2';
        elsif table_name='quiz_attempt_answers' then predicate:='r.attempt_id in (select id from public.quiz_attempts where workspace_id=$1 and learner_id=$2)';
        elsif table_name in ('quiz_answer_attempts','quiz_attempt_question_queue') then predicate:='r.quiz_attempt_id in (select id from public.quiz_attempts where workspace_id=$1 and learner_id=$2)';
        else predicate:='r.learner_id=$2'; end if;
        execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where r.workspace_id=$1 and %s',table_name,predicate)
          into rows using w,l;
        result:=result||jsonb_build_object(table_name,rows);
      end loop;
      return result;
    end$state$$definition$;
  begin
    select id into strict w from public.workspaces where slug='family-learning-hub';
    select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and metadata->'is_test'='true'::jsonb;
    insert into auth.users(id,email) values(owner_id,'qa-outcomes-owner@example.invalid'),(teacher_id,'qa-outcomes-teacher@example.invalid');
    insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,teacher_id,'teacher');
    insert into public.learners(id,workspace_id,display_name,slug,metadata) values(other_l,w,'Synthetic Testing sibling','qa-outcomes-sibling','{"is_test":true}');
    insert into public.curricula(id,code,name_ar) values(curriculum,'qa-video-outcomes-curriculum','Synthetic Testing curriculum');
    insert into public.subjects(code,name_ar) values('qa-video-outcomes','Synthetic Testing subject') returning id into subject;
    insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level)
      values(program,w,'qa-video-outcomes','Synthetic Testing program','active',curriculum,7);
    insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values(w,l,program,'active');
    insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status)
      values(quiz,w,subject,curriculum,'qa-video-outcomes','Synthetic Testing exercise','active');
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values(version,w,quiz,1,'published');
    insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability) values(w,program,quiz,'available');
    insert into public.learning_concepts(id,workspace_id,subject_id,curriculum_id,grade_level,code,title) values
      (concept_one,w,subject,curriculum,7,'qa-outcomes-one','Synthetic concept one'),
      (concept_two,w,subject,curriculum,7,'qa-outcomes-two','Synthetic concept two');
    insert into public.quiz_questions(id,workspace_id,quiz_version_id,position,question_type,prompt,origin,delivery_role,prompt_language) values
      (question_one,w,version,1,'single_choice','Synthetic question one','generated','core','en'),
      (question_two,w,version,2,'single_choice','Synthetic question two','generated','core','en');
    insert into public.quiz_question_options(workspace_id,question_id,position,content) values(w,question_one,1,'One'),(w,question_two,1,'Two');
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary) values(w,question_one,concept_one,true),(w,question_two,concept_two,true);
    insert into public.quiz_question_answer_keys(workspace_id,question_id,correct_answer,explanation) values
      (w,question_one,'{"option_position":1,"sentinel":"OUTCOMES_PRIVATE_KEY"}','OUTCOMES_PRIVATE_EXPLANATION'),
      (w,question_two,'{"option_position":1,"sentinel":"OUTCOMES_PRIVATE_KEY"}','OUTCOMES_PRIVATE_EXPLANATION');
    update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id=w and key='optional_learning_videos';
    base:=jsonb_build_object('learner_id',l,'quiz_version_id',version,'program_id',program,'curriculum_id',curriculum,
      'grade_level',7,'subject_id',subject,'title','Original synthetic lesson','language','en','rationale','OUTCOMES_PRIVATE_SOURCE_REVIEW',
      'embeddable',true,'made_for_kids',false,'verified_at',now(),'verification_expires_at',now()+interval '7 days');

    perform pg_temp.outcomes_assert(not has_function_privilege('authenticated','public.flh_learning_video_attach(uuid,uuid,jsonb)','EXECUTE')
      and not has_function_privilege('anon','public.flh_learning_video_preview(uuid,uuid,text)','EXECUTE')
      and not has_function_privilege('authenticated','private.flh_learning_video_outcomes_valid(text[])','EXECUTE'),'new and replaced functions stay service-only');
    perform pg_temp.outcomes_assert(not has_table_privilege('authenticated','public.learning_video_assignments','UPDATE')
      and not has_table_privilege('anon','public.learning_video_attempts','SELECT'),'browser roles cannot access outcome storage');
    perform pg_temp.outcomes_assert((select bool_and(relrowsecurity) from pg_class where oid in
      ('public.learning_video_assignments'::regclass,'public.learning_video_attempts'::regclass)),'existing RLS remains enabled');
    perform pg_temp.outcomes_assert((select bool_and(not prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in
      ('public.flh_learning_video_attach(uuid,uuid,jsonb)'::regprocedure,'public.flh_learning_video_preview(uuid,uuid,text)'::regprocedure,
       'private.flh_learning_optional_video(uuid,uuid,uuid,uuid)'::regprocedure)),'invoker and fixed search_path remain intact');

    set local role service_role;
    perform pg_temp.outcomes_assert(private.flh_learning_video_outcomes_valid(null),'legacy NULL accepted without inferred text');
    perform pg_temp.outcomes_assert(private.flh_learning_video_outcomes_valid(array['Compare 1/2 and 1/3','رتّب الأعداد','Kesirleri karşılaştır']), '1-3 distinct multilingual plain-text outcomes accepted');
    perform pg_temp.outcomes_assert(private.flh_learning_video_outcomes_valid(array[repeat('😀',160)])
      and not private.flh_learning_video_outcomes_valid(array[repeat('😀',161)]),'length is Unicode characters, not bytes or UTF-16 units');
    perform pg_temp.outcomes_assert(not private.flh_learning_video_outcomes_valid(array[['One','Two'],['Three','Four']])
      and not private.flh_learning_video_outcomes_valid('[0:0]={One}'::text[]),'only a canonical one-dimensional array accepted');
    candidate:=base||jsonb_build_object('concept_id',concept_one,'video_ref','qaOutcome01');
    result:=public.flh_learning_video_attach(w,teacher_id,candidate);
    perform pg_temp.outcomes_assert(result->>'error'='VIDEO_ATTACHMENT_FORBIDDEN','author role checks preserved');
    result:=public.flh_learning_video_attach(w,owner_id,candidate||jsonb_build_object('learner_id',other_l));
    perform pg_temp.outcomes_assert(result->>'error'='VIDEO_CONTEXT_MISMATCH','unassigned sibling rejected');
    result:=public.flh_learning_video_attach(gen_random_uuid(),owner_id,candidate);
    perform pg_temp.outcomes_assert(result->>'error'='VIDEO_ATTACHMENT_FORBIDDEN','cross-workspace author rejected');
    result:=public.flh_learning_video_attach(w,owner_id,candidate||'{"embeddable":false}'::jsonb);
    perform pg_temp.outcomes_assert(result->>'error'='VIDEO_CONTEXT_MISMATCH','provider fail-closed check preserved');
    for invalid_json in select value from jsonb_array_elements(jsonb_build_array(
      null,'[]'::jsonb,'{}'::jsonb,'"text"'::jsonb,'[null]'::jsonb,'[1]'::jsonb,'[{}]'::jsonb,'[["One"]]'::jsonb,
      '[""]'::jsonb,'["   "]'::jsonb,'["One"," One "]'::jsonb,'["One","Two","Three","Four"]'::jsonb,
      '["<b>One</b>"]'::jsonb,'["<!-- hidden -->"]'::jsonb,'["&lt;script&gt;"]'::jsonb,'["&#39;"]'::jsonb,
      jsonb_build_array(repeat('😀',161)))) loop
      result:=public.flh_learning_video_attach(w,owner_id,candidate||jsonb_build_object('learning_outcomes',invalid_json));
      perform pg_temp.outcomes_assert(result->>'error'='INVALID_VIDEO_INPUT','malformed supplied outcome JSON rejected: '||invalid_json::text);
    end loop;
    result:=public.flh_learning_video_attach(w,owner_id,candidate||'{"readiness_questions":[],"grading_config":{}}'::jsonb);
    perform pg_temp.outcomes_assert(result->>'error'='INVALID_VIDEO_INPUT','unknown fields remain closed on direct service RPC');
    result:=public.flh_learning_video_attach(w,owner_id,'[]'::jsonb);
    perform pg_temp.outcomes_assert(result->>'error'='INVALID_VIDEO_INPUT','non-object service input rejected without exception');
    perform pg_temp.outcomes_assert((select count(*)=0 from public.learning_video_assignments where learner_id=l and quiz_version_id=version),'all rejected inputs leave assignments untouched');

    result:=public.flh_learning_video_attach(w,owner_id,candidate);
    perform pg_temp.outcomes_assert(result->>'ok'='true' and result->>'position'='1','legacy omitted outcomes/position remain compatible');
    assignment_one:=(result->>'assignment_id')::uuid; video_one:=(result->>'video_id')::uuid;
    reviewed:=base||jsonb_build_object('concept_id',concept_two,'position',2,'video_ref','qaOutcome02',
      'learning_outcomes',jsonb_build_array(E'\t Compare 1/2 and 1/3 \n',U&'\00A0Find a shared denominator\3000'));
    result:=public.flh_learning_video_attach(w,owner_id,reviewed);
    perform pg_temp.outcomes_assert(result->>'ok'='true','reviewed outcomes attach with existing provider status fields');
    assignment_two:=(result->>'assignment_id')::uuid; video_two:=(result->>'video_id')::uuid;
    perform pg_temp.outcomes_assert((select learning_outcomes=array['Compare 1/2 and 1/3','Find a shared denominator'] from public.learning_video_assignments where id=assignment_two),'candidate strings normalize in order at SQL boundary');
    result:=public.flh_learning_video_attach(w,owner_id,candidate||'{"learning_outcomes":["Legacy addition"]}'::jsonb);
    perform pg_temp.outcomes_assert(result->>'error'='INVALID_VIDEO_INPUT' and (select learning_outcomes is null and video_revision=video_one from public.learning_video_assignments where id=assignment_one),'multi-video omitted-position guard cannot replace slot 1');
    result:=public.flh_learning_start(w,l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(result->>'error' is null,'existing Learning start accepts the optional carrier');
    attempt:=(result->>'attempt_id')::uuid;
    frozen:=result->'optional_video';
    perform pg_temp.outcomes_assert(jsonb_array_length(frozen->'videos')=2 and frozen->'videos'->0->'learning_outcomes'='null'::jsonb
      and frozen->'videos'->1->'learning_outcomes'='["Compare 1/2 and 1/3","Find a shared denominator"]'::jsonb,'first entry snapshots exact ordered outcomes and legacy NULL');
    perform pg_temp.outcomes_assert(position('OUTCOMES_PRIVATE_' in frozen::text)=0 and position('grading_config' in frozen::text)=0
      and position('is_correct' in frozen::text)=0,'safe video payload excludes source review, keys and grading');
    academic_before:=pg_temp.outcomes_academic_state(w,l);

    for invalid_array in select value from (values
      (array[]::text[]),(array[null]::text[]),(array['']),(array[' One ']),(array['One','One']),
      (array['One','Two','Three','Four']),(array['<em>One</em>']),(array['&#x3c;']),
      (array[repeat('😀',161)]),('[0:0]={One}'::text[])) as invalid(value) loop
      begin
        update public.learning_video_assignments set learning_outcomes=invalid_array where id=assignment_two;
        raise exception 'Malformed assignment outcome passed table constraint';
      exception when check_violation then null; end;
      begin
        update public.learning_video_attempts set learning_outcomes=invalid_array where attempt_id=attempt and video_id=video_two;
        raise exception 'Malformed snapshot outcome passed table constraint';
      exception when check_violation then null; end;
    end loop;

    select status_revision into status_token from public.learning_video_assignments where id=assignment_two;
    result:=public.flh_learning_video_refresh(w,assignment_two,video_two,status_token,reviewed);
    perform pg_temp.outcomes_assert(result->>'availability'='available' and (select learning_outcomes=array['Compare 1/2 and 1/3','Find a shared denominator']
      and title='Original synthetic lesson' and language='en' and self_report='not_reported' and report_revision=0 from public.learning_video_attempts where attempt_id=attempt and video_id=video_two),'provider refresh preserves authored snapshot without viewing claims');
    select status_revision into status_token from public.learning_video_assignments where id=assignment_two;
    result:=public.flh_learning_video_refresh(w,assignment_two,video_two,status_token,null);
    perform pg_temp.outcomes_assert(result->>'availability'='unavailable' and (select learning_outcomes is not null and report_revision=0 from public.learning_video_attempts where attempt_id=attempt and video_id=video_two),'provider failure cannot erase outcomes or create a report');
    result:=public.flh_learning_video_attach(w,owner_id,reviewed);
    perform pg_temp.outcomes_assert(result->>'video_id'=video_two::text,'provider-status-only reattachment retains content revision');
    update public.learning_video_assignments set verified_at=now()-interval '31 days',verification_expires_at=now()-interval '24 days' where id=assignment_two;
    update public.learning_video_attempts set verified_at=now()-interval '31 days',verification_expires_at=now()-interval '24 days' where attempt_id=attempt and video_id=video_two;
    result:=public.flh_learning_video_prune_status(w);
    perform pg_temp.outcomes_assert((select verification_state='expired' and verified_at is null and learning_outcomes=array['Compare 1/2 and 1/3','Find a shared denominator']
      and self_report='not_reported' from public.learning_video_attempts where attempt_id=attempt and video_id=video_two),'status retention/pruning leaves authored text and reports independent');
    result:=public.flh_learning_video_attach(w,owner_id,reviewed);
    perform pg_temp.outcomes_assert(result->>'video_id'=video_two::text,'restored provider status still retains content revision');

    previous_video:=video_two;
    reviewed:=reviewed||'{"learning_outcomes":["Compare fractions using equivalent parts"]}'::jsonb;
    result:=public.flh_learning_video_attach(w,owner_id,reviewed); current_video:=(result->>'video_id')::uuid;
    perform pg_temp.outcomes_assert(current_video<>previous_video,'outcome-only edit rotates content revision'); previous_video:=current_video;
    reviewed:=reviewed||'{"title":"Revised synthetic lesson"}'::jsonb;
    result:=public.flh_learning_video_attach(w,owner_id,reviewed); current_video:=(result->>'video_id')::uuid;
    perform pg_temp.outcomes_assert(current_video<>previous_video,'title-only edit rotates content revision'); previous_video:=current_video;
    reviewed:=reviewed||'{"language":"tr"}'::jsonb;
    result:=public.flh_learning_video_attach(w,owner_id,reviewed); current_video:=(result->>'video_id')::uuid;
    perform pg_temp.outcomes_assert(current_video<>previous_video,'language-only edit rotates content revision');
    result:=public.flh_learning_video_attach(w,owner_id,reviewed||'{"rationale":"Re-reviewed synthetic source"}'::jsonb);
    perform pg_temp.outcomes_assert(result->>'video_id'=current_video::text,'source review/provider refresh do not rotate unchanged educational content');
    result:=public.flh_learning_video_attach(w,owner_id,candidate||'{"position":1,"title":"New legacy lesson","language":"ar","learning_outcomes":["Compare equal parts"]}'::jsonb);
    perform pg_temp.outcomes_assert(result->>'video_id'<>video_one::text,'adding reviewed outcomes to a future legacy assignment rotates content revision');
    resumed:=public.flh_learning_start(w,l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(resumed->>'attempt_id'=attempt::text and resumed->'optional_video'=frozen,'resume retains original ordered title/language/outcomes without legacy backfill');
    select jsonb_agg(to_jsonb(s) order by s.position) into snapshots_before from public.learning_video_attempts s where workspace_id=w and attempt_id=attempt;
    preview:=public.flh_learning_video_preview(w,l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(preview->>'resumable_attempt_id'=attempt::text and preview->'optional_video'->'videos'->0->'learning_outcomes'='["Compare equal parts"]'::jsonb
      and preview->'optional_video'->'videos'->1->'learning_outcomes'='["Compare fractions using equivalent parts"]'::jsonb
      and preview->'optional_video'->'videos'->1->>'title'='Revised synthetic lesson' and preview->'optional_video'->'videos'->1->>'language'='tr','current assignment preview returns current authored content separately from old attempt');
    perform pg_temp.outcomes_assert(position('OUTCOMES_PRIVATE_' in preview::text)=0 and position('grading_config' in preview::text)=0 and position('is_correct' in preview::text)=0,'read-only preview exposes only safe video metadata');
    perform pg_temp.outcomes_assert((select jsonb_agg(to_jsonb(s) order by s.position)=snapshots_before from public.learning_video_attempts s where workspace_id=w and attempt_id=attempt),'preview creates/replaces no snapshots');
    preview:=public.flh_learning_video_preview(w,other_l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(preview->>'error'='QUIZ_NOT_AVAILABLE','unauthorized sibling cannot preview outcomes');
    preview:=public.flh_learning_video_preview(gen_random_uuid(),l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(preview->>'error'='QUIZ_NOT_FOUND','cross-tenant preview returns no data');
    result:=public.flh_learning_video_attach(w,owner_id,reviewed-'learning_outcomes');
    perform pg_temp.outcomes_assert(result->>'video_id'<>current_video::text and (select learning_outcomes is null from public.learning_video_assignments where id=assignment_two),'omitted new carrier stores NULL and is a content change from reviewed text');
    resumed:=public.flh_learning_start(w,l,'qa-video-outcomes');
    perform pg_temp.outcomes_assert(resumed->'optional_video'=frozen and (select count(*)=2 from public.learning_video_attempts where attempt_id=attempt),'removing future outcomes and retries never rewrite frozen snapshots');
    perform pg_temp.outcomes_assert(pg_temp.outcomes_academic_state(w,l)=academic_before,'video authoring/preview/status/resume leaves formal attempts, answers, queue/hints, mastery, learner metadata, XP, wallet and ledger unchanged');
    reset role;
    raise exception 'Optional video outcomes contract success rollback' using errcode='P0O22';
  exception when sqlstate 'P0O22' then
    reset role;
    raise notice 'Optional authored outcomes validation, service boundaries, revisions, immutable legacy snapshots and read-only preview passed; fixtures rolled back.';
  end;
end;
$contract$;
