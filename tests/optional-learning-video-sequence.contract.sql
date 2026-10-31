-- FLH-FEAT-2026-018 v1.5 ordered optional video sequence contract.
-- Synthetic Testing-only fixtures; the whole block rolls back on success.
do $contract$
declare
  w uuid; l uuid; owner_id uuid:=gen_random_uuid();
  curriculum uuid:=gen_random_uuid(); program uuid:=gen_random_uuid(); quiz uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
  concept_one uuid:=gen_random_uuid(); concept_two uuid:=gen_random_uuid(); question_one uuid:=gen_random_uuid(); question_two uuid:=gen_random_uuid();
  other_learner uuid:=gen_random_uuid(); exam_attempt uuid:=gen_random_uuid(); counts_before jsonb;
  progress_request uuid:=gen_random_uuid();
  subject bigint; base jsonb; result jsonb; resumed jsonb; preview jsonb; report jsonb; attempt uuid; video_one uuid; video_two uuid;
begin
  execute $definition$create or replace function pg_temp.sequence_assert(ok boolean,message text) returns void language plpgsql as $assert$begin if ok is distinct from true then raise exception 'Optional video sequence contract: %',message; end if; end$assert$$definition$;
  begin
    select id into strict w from public.workspaces where slug='family-learning-hub';
    select id into strict l from public.learners where workspace_id=w and slug='test' and is_active and metadata->'is_test'='true'::jsonb;
    insert into auth.users(id,email) values(owner_id,'qa-video-sequence-owner@example.invalid');
    insert into public.workspace_members(workspace_id,user_id,role) values(w,owner_id,'owner');
    insert into public.curricula(id,code,name_ar) values(curriculum,'qa-video-sequence-curriculum','QA sequence curriculum');
    insert into public.subjects(code,name_ar) values('qa-optional-video-sequence','QA video sequence subject') returning id into subject;
    insert into public.learning_programs(id,workspace_id,slug,title,status,curriculum_id,grade_level)
      values(program,w,'qa-optional-video-sequence','QA video sequence program','active',curriculum,7);
    insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values(w,l,program,'active');
    insert into public.quizzes(id,workspace_id,subject_id,curriculum_id,slug,title,status)
      values(quiz,w,subject,curriculum,'qa-optional-video-sequence','QA video sequence exercise','active');
    insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state) values(version,w,quiz,1,'published');
    insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability) values(w,program,quiz,'available');
    insert into public.learning_concepts(id,workspace_id,subject_id,curriculum_id,grade_level,code,title) values
      (concept_one,w,subject,curriculum,7,'qa-video-sequence-one','Sequence concept one'),
      (concept_two,w,subject,curriculum,7,'qa-video-sequence-two','Sequence concept two');
    insert into public.quiz_questions(id,workspace_id,quiz_version_id,position,question_type,prompt,origin,delivery_role,prompt_language) values
      (question_one,w,version,1,'single_choice','Question one','generated','core','en'),
      (question_two,w,version,2,'single_choice','Question two','generated','core','en');
    insert into public.quiz_question_options(workspace_id,question_id,position,content) values
      (w,question_one,1,'One'),(w,question_two,1,'Two');
    insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation,grading_config) values
      (question_one,w,'{"option_position":1}','base','correct','incorrect','{}'),
      (question_two,w,'{"option_position":1}','base','correct','incorrect','{}');
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary) values
      (w,question_one,concept_one,true),(w,question_two,concept_two,true);

    base:=jsonb_build_object(
      'learner_id',l,'quiz_version_id',version,'program_id',program,'curriculum_id',curriculum,'grade_level',7,'subject_id',subject,
      'title','Sequence lesson','language','en','rationale','Synthetic exact target sequence',
      'embeddable',true,'made_for_kids',false,'verified_at',now(),'verification_expires_at',now()+interval '7 days'
    );

    update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id=w and key='optional_learning_videos';
    set local role service_role;
    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_one,'video_ref','qaSeqVid001'));
    perform pg_temp.sequence_assert(result->>'ok'='true' and result->>'position'='1','single-video authoring may omit position and defaults to position 1');
    video_one:=(result->>'video_id')::uuid;
    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_two,'position',2,'video_ref','qaSeqVid002'));
    perform pg_temp.sequence_assert(result->>'ok'='true' and result->>'position'='2','position 2 attaches');
    video_two:=(result->>'video_id')::uuid;
    perform pg_temp.sequence_assert((select count(*)=2 from public.learning_video_assignments where workspace_id=w and learner_id=l and quiz_version_id=version),'two assignments coexist for one learner/version');

    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_one,'video_ref','qaSeqVid004'));
    perform pg_temp.sequence_assert(result->>'error'='INVALID_VIDEO_INPUT','omitted position is rejected after a higher sequence position exists');
    perform pg_temp.sequence_assert((select video_ref='qaSeqVid001' from public.learning_video_assignments where workspace_id=w and learner_id=l and quiz_version_id=version and position=1),'rejected omitted position cannot replace slot 1');

    result:=public.flh_learning_start(w,l,'qa-optional-video-sequence');
    attempt:=(result->>'attempt_id')::uuid;
    perform pg_temp.sequence_assert(jsonb_array_length(result->'optional_video'->'videos')=2,'start returns two ordered videos');
    perform pg_temp.sequence_assert(result->'optional_video'->'videos'->0->>'position'='1' and result->'optional_video'->'videos'->0->>'id'=video_one::text,'first lesson ordered and pinned');
    perform pg_temp.sequence_assert(result->'optional_video'->'videos'->1->>'position'='2' and result->'optional_video'->'videos'->1->>'id'=video_two::text,'second lesson ordered and pinned');
    perform pg_temp.sequence_assert((select count(*)=2 from public.learning_video_attempts where workspace_id=w and attempt_id=attempt),'attempt snapshots entire sequence once');

    report:=public.flh_learning_video_report(w,l,attempt,video_two,'watched_part',0,gen_random_uuid());
    perform pg_temp.sequence_assert(report->>'report_revision'='1','second lesson report saves');
    perform pg_temp.sequence_assert((select self_report='not_reported' from public.learning_video_attempts where attempt_id=attempt and video_id=video_one),'first lesson report remains independent');
    perform pg_temp.sequence_assert((select self_report='watched_part' from public.learning_video_attempts where attempt_id=attempt and video_id=video_two),'selected lesson report updated');

    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_one,'position',1,'video_ref','qaSeqVid003'));
    perform pg_temp.sequence_assert(result->>'ok'='true' and (result->>'video_id')::uuid<>video_one,'replacing a position rotates video identity');
    resumed:=public.flh_learning_start(w,l,'qa-optional-video-sequence');
    perform pg_temp.sequence_assert(resumed->>'attempt_id'=attempt::text,'resume keeps the same Learning attempt');
    perform pg_temp.sequence_assert(resumed->'optional_video'->'videos'->0->>'video_ref'='qaSeqVid001','resume keeps the original position-1 snapshot');
    perform pg_temp.sequence_assert(resumed->'optional_video'->'videos'->1->>'video_ref'='qaSeqVid002','resume keeps the original position-2 snapshot');

    preview:=public.flh_learning_video_preview(w,l,'qa-optional-video-sequence');
    perform pg_temp.sequence_assert(preview->>'resumable_attempt_id'=attempt::text,'preview identifies the existing progressed attempt without starting another');
    perform pg_temp.sequence_assert(jsonb_array_length(preview->'optional_video'->'videos')=2,'preview returns the current ordered assignment sequence');
    perform pg_temp.sequence_assert(preview->'optional_video'->'videos'->0->>'video_ref'='qaSeqVid003','preview sees the current replacement instead of rewriting the historical attempt snapshot');
    perform pg_temp.sequence_assert(preview->'optional_video'->'videos'->1->>'video_ref'='qaSeqVid002','preview keeps current second lesson ordering');
    perform pg_temp.sequence_assert((select count(*)=2 from public.learning_video_attempts where workspace_id=w and attempt_id=attempt),'preview is read-only and does not add or replace attempt snapshots');

    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_two,'position',3,'video_ref','qaSeqVid002'));
    perform pg_temp.sequence_assert(result->>'error'='INVALID_VIDEO_INPUT','same provider reference cannot be duplicated in another position');

    -- FLH-041: exact owned Learning history retains its pinned ordered videos.
    perform pg_temp.sequence_assert(not has_function_privilege('anon','public.flh_learning_video_preview(uuid,uuid,text,uuid)','EXECUTE')
      and not has_function_privilege('authenticated','public.flh_learning_video_preview(uuid,uuid,text,uuid)','EXECUTE'),'exact-attempt preview remains service-only');
    select jsonb_build_object('attempts',(select count(*) from public.quiz_attempts where workspace_id=w),
      'answers',(select count(*) from public.quiz_answer_attempts where workspace_id=w),
      'rewards',(select count(*) from public.gamification_events where workspace_id=w)) into counts_before;
    preview:=public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',attempt);
    perform pg_temp.sequence_assert(preview->'optional_video'->'videos'->0->>'video_ref'='qaSeqVid001','in-Learning preview uses its original snapshot');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',gen_random_uuid())->>'error'='VIDEO_NOT_AVAILABLE','foreign/missing attempt denied');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(gen_random_uuid(),l,'qa-optional-video-sequence',attempt)->>'error'='QUIZ_NOT_FOUND','cross-workspace attempt denied');
    reset role;
    insert into public.learners(id,workspace_id,display_name,slug,metadata) values(other_learner,w,'Synthetic other learner','qa-041-other','{"is_test":true}');
    insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status) values(w,other_learner,program,'active');
    update public.quiz_attempts set status='submitted',submitted_at=now() where workspace_id=w and id=attempt;
    set local role service_role;
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,other_learner,'qa-optional-video-sequence',attempt)->>'error'='VIDEO_NOT_AVAILABLE','another enrolled learner cannot read a foreign snapshot');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,other_learner,'qa-optional-video-sequence')->>'error'='VIDEO_NOT_AVAILABLE','program enrollment does not expose another learner video assignment');
    preview:=public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',attempt);
    perform pg_temp.sequence_assert(preview->'optional_video'->'videos'->0->>'video_ref'='qaSeqVid001','submitted Learning history keeps its immutable video');
    perform pg_temp.sequence_assert(jsonb_build_object('attempts',(select count(*) from public.quiz_attempts where workspace_id=w),
      'answers',(select count(*) from public.quiz_answer_attempts where workspace_id=w),
      'rewards',(select count(*) from public.gamification_events where workspace_id=w))=counts_before,'preview never creates attempts, answers or rewards');
    reset role;
    insert into public.quiz_attempts(id,workspace_id,learner_id,quiz_version_id,status,delivery_mode)
      values(exam_attempt,w,l,version,'in_progress','exam');
    set local role service_role;
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence')->>'error'='VIDEO_NOT_AVAILABLE','active Exam blocks library route');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',attempt)->>'error'='VIDEO_NOT_AVAILABLE','active Exam blocks old submitted review route');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',exam_attempt)->>'error'='VIDEO_NOT_AVAILABLE','active Exam cannot masquerade as submitted review');
    reset role;
    -- Submit a complete synthetic Exam through the existing grading path. An
    -- empty attempt cannot bypass the academic completeness/mastery invariant.
    insert into public.quiz_attempt_question_queue(workspace_id,quiz_attempt_id,sequence_no,question_id,difficulty_level,status,source_role) values
      (w,exam_attempt,1,question_one,2,'active','core'),
      (w,exam_attempt,2,question_two,2,'active','core');
    insert into public.quiz_attempt_answers(workspace_id,attempt_id,question_id,response,evaluation,is_correct,points_awarded,attempts_used,hints_used,first_try_correct,mastery_result,quiz_version_id) values
      (w,exam_attempt,question_one,'{"option_position":1}','ungraded',null,null,1,0,null,null,version),
      (w,exam_attempt,question_two,'{"option_position":1}','ungraded',null,null,1,0,null,null,version);
    set local role service_role;
    result:=public.flh_exam_submit(w,l,exam_attempt);
    perform pg_temp.sequence_assert(result->>'error' is null and (select status='submitted' from public.quiz_attempts where id=exam_attempt),'synthetic Exam submits through the authoritative path');
    -- Academic submission may award rewards; subsequent video operations must
    -- leave that post-submission balance unchanged.
    counts_before:=jsonb_set(counts_before,'{rewards}',to_jsonb((select count(*) from public.gamification_events where workspace_id=w)));
    preview:=public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',exam_attempt);
    perform pg_temp.sequence_assert(preview->>'quiz_version_id'=version::text and preview->'optional_video'->'videos'->0->>'video_ref'='qaSeqVid003','submitted Exam uses its exact version assignments');
    reset role;
    -- FLH-041: isolated persistence, eligibility, optimistic revisions and deletion.
    perform pg_temp.sequence_assert((select relrowsecurity from pg_class where oid='public.learning_video_progress'::regclass),'progress has RLS');
    perform pg_temp.sequence_assert(not has_table_privilege('anon','public.learning_video_progress','SELECT') and not has_table_privilege('authenticated','public.learning_video_progress','UPDATE'),'direct client access forbidden');
    perform pg_temp.sequence_assert(not has_function_privilege('authenticated','public.flh_learning_video_progress(uuid,uuid,text,uuid,uuid,text,bigint,uuid,integer,boolean)','EXECUTE'),'progress RPC service-only');
    set local role service_role;
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'read',0,null,0,false);
    perform pg_temp.sequence_assert(result->>'eligible'='true' and result->>'has_progress'='false','unstarted video has no marker');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',0,progress_request,83,false);
    perform pg_temp.sequence_assert(result->>'position_seconds'='83' and result->>'revision'='1','save stores per learner provider marker');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',0,progress_request,83,false);
    perform pg_temp.sequence_assert(result->>'revision'='1','lost-response retry idempotent');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',0,progress_request,90,false)->>'error'='VIDEO_PROGRESS_REQUEST_CONFLICT','mutation ID cannot change payload');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',0,gen_random_uuid(),99,false)->>'error'='VIDEO_PROGRESS_CONFLICT','stale device cannot overwrite');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,other_learner,'qa-optional-video-sequence',attempt,video_one,'read',0,null,0,false)->>'error'='VIDEO_NOT_AVAILABLE','synthetic other-learner video denied');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(gen_random_uuid(),l,'qa-optional-video-sequence',attempt,video_one,'read',0,null,0,false)->>'error'='VIDEO_NOT_AVAILABLE','cross-workspace denied');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_two,'read',0,null,0,false);
    perform pg_temp.sequence_assert(result->>'has_progress'='false','second video independent');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',1,gen_random_uuid(),180,true);
    perform pg_temp.sequence_assert(result->>'ended'='true','ended is approximate state only');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'clear',2,gen_random_uuid(),0,false);
    perform pg_temp.sequence_assert(result->>'has_progress'='false' and result->>'position_seconds'='0','clear erases timing');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',2,gen_random_uuid(),99,false)->>'error'='VIDEO_PROGRESS_CONFLICT','tombstone prevents old save restoring deleted timing');
    reset role;
    update public.learning_video_attempts set made_for_kids=true where workspace_id=w and attempt_id=attempt and video_id=video_one;
    set local role service_role;
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'read',0,null,0,false)->>'eligible'='false','MFK never exposes timing');
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'save',0,gen_random_uuid(),99,false)->>'error'='VIDEO_PROGRESS_INELIGIBLE','MFK saves denied');
    perform pg_temp.sequence_assert((select count(*)=0 from public.learning_video_progress where workspace_id=w and learner_id=l and video_ref='qaSeqVid001'),'ineligible marker removed');
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',attempt)->'optional_video'->'videos'->0->>'availability'='available','MFK playback remains available');
    reset role;
    update public.learning_video_attempts set made_for_kids=false,verification_expires_at=now()-interval '1 second' where workspace_id=w and attempt_id=attempt and video_id=video_one;
    set local role service_role;
    perform pg_temp.sequence_assert(public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_one,'read',0,null,0,false)->>'eligible'='false','expired eligibility disables timing only');
    result:=public.flh_learning_video_progress(w,l,'qa-optional-video-sequence',attempt,video_two,'save',0,gen_random_uuid(),44,false);
    perform pg_temp.sequence_assert(result->>'revision'='1','second video can be saved independently');
    reset role;
    update public.learning_video_progress set updated_at=now()-interval '30 days' where workspace_id=w and learner_id=l;
    perform public.flh_learning_video_prune_status(w);
    perform pg_temp.sequence_assert((select count(*)=0 from public.learning_video_progress where workspace_id=w and learner_id=l),'daily maintenance erases expired timing');
    perform pg_temp.sequence_assert((select count(*) from public.gamification_events where workspace_id=w)=(counts_before->>'rewards')::bigint,'resume never changes rewards');
    update public.learner_program_enrollments set status='paused' where workspace_id=w and learner_id=l and program_id=program;
    set local role service_role;
    perform pg_temp.sequence_assert(public.flh_learning_video_preview(w,l,'qa-optional-video-sequence',attempt)->>'error'='QUIZ_NOT_AVAILABLE','revoked enrollment cannot use a historical video snapshot');
    reset role;
    raise exception 'Optional video sequence success rollback' using errcode='P0S12';
  exception when sqlstate 'P0S12' then
    reset role;
    raise notice 'Optional video ordered sequence, read-only preview, snapshot stability and per-video report isolation passed; fixtures rolled back.';
  end;
end;
$contract$;
