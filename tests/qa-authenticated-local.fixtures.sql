-- Synthetic transport fixtures only, FLH026 v1.1 Drive revision2.
-- Executed only through the guarded, inspected disposable Runner container.
-- No real family package, attempt, PIN, provider collection or academic publication.
begin;
do $fixture$
declare
  workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  parent_id constant uuid := '__QA_PARENT_ID__';
  book constant uuid := '02610000-0000-4000-8000-000000000001';
  program constant uuid := '02610000-0000-4000-8000-000000000002';
  quiz constant uuid := '02610000-0000-4000-8000-000000000003';
  version constant uuid := '02610000-0000-4000-8000-000000000004';
  learner uuid;
  subject bigint;
  question uuid;
begin
  if current_database() <> 'postgres' or current_user <> 'postgres' then raise exception 'QA_LOCAL_DATABASE_INVALID'; end if;
  if (select count(*) from public.learners) <> 1 or not exists (
    select 1 from public.learners where workspace_id=workspace and slug='test' and is_active
      and metadata @> '{"is_test":true,"qa_automation":true,"exclude_from_parent_metrics":true}'
  ) then raise exception 'QA_LOCAL_TEST_LEARNER_INVALID'; end if;
  if (select count(*) from auth.users) <> 1 or not exists (
    select 1 from auth.users where id=parent_id and raw_app_meta_data @> '{"technical_qa":true}'
      and email like 'flh-qa-parent-%@example.test'
  ) then raise exception 'QA_LOCAL_PARENT_INVALID'; end if;
  if exists(select 1 from public.quiz_attempts) or exists(select 1 from private.qa_run_leases)
    or exists(select 1 from public.quizzes where slug='qa-automation-core')
    or exists(select 1 from public.books where code='QA-AUTOMATION-SYNTHETIC')
  then raise exception 'QA_LOCAL_FIXTURE_NAMESPACE_NOT_EMPTY'; end if;
  select id into strict learner from public.learners where workspace_id=workspace and slug='test';
  insert into public.workspace_members(workspace_id,user_id,role) values(workspace,parent_id,'owner');
  insert into public.subjects(code,name_ar,name_en) values('qa-automation-synthetic','اختبار تقني اصطناعي','Synthetic technical QA') returning id into subject;
  insert into public.books(id,subject_id,code,title,language,source_kind,source_metadata)
    values(book,subject,'QA-AUTOMATION-SYNTHETIC','QA Automation Book','en','custom','{"technical_qa":true,"academic_publication":false}');
  insert into public.learning_programs(id,workspace_id,slug,title,status,program_type,primary_language,metadata)
    values(program,workspace,'qa-automation-testing','QA Automation — Testing','active','custom','en','{"technical_qa":true}');
  insert into public.program_books(workspace_id,program_id,book_id,sort_order) values(workspace,program,book,1);
  insert into public.quizzes(id,workspace_id,subject_id,book_id,slug,title,status,quiz_kind,delivery_config)
    values(quiz,workspace,subject,book,'qa-automation-core','Synthetic technical QA','active','practice','{"exam":{"question_count":3}}');
  insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state,settings,published_at)
    values(version,workspace,quiz,1,'published','{"technical_qa":true,"academic_publication":false}',now());
  insert into public.program_quizzes(workspace_id,program_id,quiz_id,availability) values(workspace,program,quiz,'available');
  insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status)
    values(workspace,learner,program,'active');
  for position in 1..3 loop
    question := ('02610000-0000-4000-8000-' || lpad((10+position)::text,12,'0'))::uuid;
    insert into public.quiz_questions(id,workspace_id,quiz_version_id,position,question_type,prompt,prompt_language,origin,delivery_role,points,source_metadata)
      values(question,workspace,version,position,'single_choice',format('Technical QA item %s: select Accept.',position),'en','generated','core',1,'{"technical_qa":true}');
    insert into public.quiz_question_options(workspace_id,question_id,position,label,content)
      values(workspace,question,1,'A','Accept'),(workspace,question,2,'B','Decline');
    insert into public.quiz_question_answer_keys(workspace_id,question_id,correct_answer,explanation)
      values(workspace,question,'{"position":1}','Synthetic transport fixture; no academic claim.');
  end loop;
  if (select count(*) from public.quiz_questions where quiz_version_id=version) <> 3 then raise exception 'QA_LOCAL_QUESTION_COUNT_INVALID'; end if;
  if not has_function_privilege('service_role','public.flh_qa_acquire_testing_lease(uuid,uuid,integer)','EXECUTE')
    or has_function_privilege('anon','public.flh_qa_acquire_testing_lease(uuid,uuid,integer)','EXECUTE')
    or has_table_privilege('anon','public.quiz_question_answer_keys','SELECT')
  then raise exception 'QA_LOCAL_PRIVILEGE_CONTRACT_INVALID'; end if;
end;
$fixture$;
commit;
