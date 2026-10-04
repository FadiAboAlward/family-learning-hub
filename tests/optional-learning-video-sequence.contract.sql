-- FLH-FEAT-2026-018 v1.2 ordered optional video sequence contract.
-- Synthetic Testing-only fixtures; the whole block rolls back on success.
do $contract$
declare
  w uuid; l uuid; owner_id uuid:=gen_random_uuid();
  curriculum uuid:=gen_random_uuid(); program uuid:=gen_random_uuid(); quiz uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
  concept_one uuid:=gen_random_uuid(); concept_two uuid:=gen_random_uuid(); question_one uuid:=gen_random_uuid(); question_two uuid:=gen_random_uuid();
  subject bigint; base jsonb; result jsonb; resumed jsonb; report jsonb; attempt uuid; video_one uuid; video_two uuid;
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
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary) values
      (w,question_one,concept_one,true),(w,question_two,concept_two,true);

    base:=jsonb_build_object(
      'learner_id',l,'quiz_version_id',version,'program_id',program,'curriculum_id',curriculum,'grade_level',7,'subject_id',subject,
      'title','Sequence lesson','language','en','rationale','Synthetic exact target sequence',
      'embeddable',true,'made_for_kids',false,'verified_at',now(),'verification_expires_at',now()+interval '7 days'
    );

    update public.workspace_settings set value='{"enabled":true,"test_only":true}' where workspace_id=w and key='optional_learning_videos';
    set local role service_role;
    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_one,'position',1,'video_ref','qaSeqVid001'));
    perform pg_temp.sequence_assert(result->>'ok'='true' and result->>'position'='1','position 1 attaches');
    video_one:=(result->>'video_id')::uuid;
    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_two,'position',2,'video_ref','qaSeqVid002'));
    perform pg_temp.sequence_assert(result->>'ok'='true' and result->>'position'='2','position 2 attaches');
    video_two:=(result->>'video_id')::uuid;
    perform pg_temp.sequence_assert((select count(*)=2 from public.learning_video_assignments where workspace_id=w and learner_id=l and quiz_version_id=version),'two assignments coexist for one learner/version');

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

    result:=public.flh_learning_video_attach(w,owner_id,base||jsonb_build_object('concept_id',concept_two,'position',3,'video_ref','qaSeqVid002'));
    perform pg_temp.sequence_assert(result->>'error'='INVALID_VIDEO_INPUT','same provider reference cannot be duplicated in another position');

    reset role;
    raise exception 'Optional video sequence success rollback' using errcode='P0S12';
  exception when sqlstate 'P0S12' then
    reset role;
    raise notice 'Optional video ordered sequence, snapshot stability and per-video report isolation passed; fixtures rolled back.';
  end;
end;
$contract$;
