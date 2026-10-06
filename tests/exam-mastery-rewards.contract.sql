-- FLH-FEAT-2026-010 v1.2
-- Deterministic Exam mastery reward contract. Runs on the disposable QA database.

begin;

create or replace function pg_temp.qa_exam_reward_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $function$
begin
  if not coalesce(p_condition,false) then
    raise exception 'EXAM_REWARD_ASSERTION_FAILED:%', p_message;
  end if;
end;
$function$;

create or replace function pg_temp.qa_make_exam_attempt(
  p_learner uuid,
  p_attempt uuid,
  p_q1_position integer,
  p_q2_position integer,
  p_q3_position integer
)
returns void
language plpgsql
as $function$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_version constant uuid := '96000000-0000-4000-8000-000000000002';
  v_q1 constant uuid := '96000000-0000-4000-8000-000000000003';
  v_q2 constant uuid := '96000000-0000-4000-8000-000000000004';
  v_q3 constant uuid := '96000000-0000-4000-8000-000000000005';
begin
  insert into public.quiz_attempts(
    id,workspace_id,learner_id,quiz_version_id,status,delivery_mode,started_at,metadata
  ) values (
    p_attempt,v_workspace,p_learner,v_version,'in_progress','exam',clock_timestamp()-interval '2 minutes',
    '{"qa":"exam-mastery-rewards-v1.2"}'::jsonb
  );

  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,difficulty_level,status,source_role
  ) values
    (v_workspace,p_attempt,1,v_q1,2,'active','core'),
    (v_workspace,p_attempt,2,v_q2,2,'active','core'),
    (v_workspace,p_attempt,3,v_q3,2,'active','core');

  insert into public.quiz_attempt_answers(
    workspace_id,attempt_id,question_id,response,evaluation,is_correct,points_awarded,
    attempts_used,hints_used,first_try_correct,mastery_result,quiz_version_id
  ) values
    (v_workspace,p_attempt,v_q1,jsonb_build_object('option_position',p_q1_position),'ungraded',null,null,1,0,null,null,v_version),
    (v_workspace,p_attempt,v_q2,jsonb_build_object('option_position',p_q2_position),'ungraded',null,null,1,0,null,null,v_version),
    (v_workspace,p_attempt,v_q3,jsonb_build_object('option_position',p_q3_position),'ungraded',null,null,1,0,null,null,v_version);
end;
$function$;

do $contract$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_quiz constant uuid := '96000000-0000-4000-8000-000000000001';
  v_version constant uuid := '96000000-0000-4000-8000-000000000002';
  v_q1 constant uuid := '96000000-0000-4000-8000-000000000003';
  v_q2 constant uuid := '96000000-0000-4000-8000-000000000004';
  v_q3 constant uuid := '96000000-0000-4000-8000-000000000005';
  v_attempt_low constant uuid := '96000000-0000-4000-8000-000000000011';
  v_attempt_82 constant uuid := '96000000-0000-4000-8000-000000000012';
  v_attempt_same constant uuid := '96000000-0000-4000-8000-000000000013';
  v_attempt_92 constant uuid := '96000000-0000-4000-8000-000000000014';
  v_attempt_100 constant uuid := '96000000-0000-4000-8000-000000000015';
  v_learner uuid;
  v_subject bigint;
  v_result jsonb;
  v_retry jsonb;
  v_target jsonb;
  v_xp integer;
  v_points integer;
  v_event_count integer;
  v_event_xp integer;
  v_event_points integer;
  r record;
begin
  perform pg_temp.qa_exam_reward_assert(
    not has_function_privilege('anon','public.flh_exam_reward_target(numeric)','EXECUTE')
    and not has_function_privilege('authenticated','public.flh_exam_reward_target(numeric)','EXECUTE')
    and has_function_privilege('service_role','public.flh_exam_reward_target(numeric)','EXECUTE'),
    'reward target helper ACL'
  );

  for r in
    select * from (values
      (79.99::numeric,10,0),
      (80.00::numeric,30,5),
      (84.99::numeric,30,5),
      (85.00::numeric,40,7),
      (89.99::numeric,40,7),
      (90.00::numeric,50,10),
      (94.99::numeric,50,10),
      (95.00::numeric,60,12),
      (99.99::numeric,60,12),
      (100.00::numeric,75,15)
    ) as thresholds(percentage,xp,reward_points)
  loop
    v_target := public.flh_exam_reward_target(r.percentage);
    perform pg_temp.qa_exam_reward_assert(
      (v_target->>'xp')::integer = r.xp
      and (v_target->>'reward_points')::integer = r.reward_points,
      'threshold ' || r.percentage::text
    );
  end loop;

  select id into strict v_learner
  from public.learners
  where workspace_id=v_workspace
    and slug='test'
    and is_active
    and coalesce((metadata->>'is_test')::boolean,false);

  insert into public.subjects(code,name_ar,name_en)
  values('QA-EXAM-REWARD-V12','مكافآت الامتحان','Exam reward QA')
  returning id into v_subject;

  insert into public.quizzes(id,workspace_id,subject_id,slug,title,status)
  values(v_quiz,v_workspace,v_subject,'qa-exam-reward-v12','Exam reward QA','active');

  insert into public.quiz_versions(id,workspace_id,quiz_id,version_no,state)
  values(v_version,v_workspace,v_quiz,1,'published');

  insert into public.quiz_questions(
    id,workspace_id,quiz_version_id,position,question_type,prompt,points,
    difficulty_level,max_attempts,remediation_after_attempt,delivery_role,question_code,prompt_language
  ) values
    (v_q1,v_workspace,v_version,1,'single_choice','weighted 82',82,2,1,1,'core','Q-96000001','en'),
    (v_q2,v_workspace,v_version,2,'single_choice','weighted 10',10,2,1,1,'core','Q-96000002','en'),
    (v_q3,v_workspace,v_version,3,'single_choice','weighted 8',8,2,1,1,'core','Q-96000003','en');

  insert into public.quiz_question_options(workspace_id,question_id,position,content)
  select v_workspace,q,1,'correct'
  from unnest(array[v_q1,v_q2,v_q3]) q;
  insert into public.quiz_question_options(workspace_id,question_id,position,content)
  select v_workspace,q,2,'wrong'
  from unnest(array[v_q1,v_q2,v_q3]) q;

  insert into public.quiz_question_answer_keys(
    question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation,grading_config
  ) values
    (v_q1,v_workspace,'{"option_position":1}','base','correct','incorrect','{}'),
    (v_q2,v_workspace,'{"option_position":1}','base','correct','incorrect','{}'),
    (v_q3,v_workspace,'{"option_position":1}','base','correct','incorrect','{}');

  insert into public.learner_gamification_state(
    workspace_id,learner_id,xp,reward_points,current_level,current_streak,longest_streak,last_learning_date
  ) values(v_workspace,v_learner,100,20,1,2,4,current_date-1)
  on conflict(learner_id) do update
  set xp=excluded.xp,
      reward_points=excluded.reward_points,
      current_level=excluded.current_level,
      current_streak=excluded.current_streak,
      longest_streak=excluded.longest_streak,
      last_learning_date=excluded.last_learning_date;

  perform pg_temp.qa_make_exam_attempt(v_learner,v_attempt_low,2,2,2);
  v_result := public.flh_exam_submit('96000000-0000-4000-8000-000000000099'::uuid,v_learner,v_attempt_low);
  perform pg_temp.qa_exam_reward_assert(v_result->>'error'='ATTEMPT_NOT_ACTIVE','workspace isolation');
  v_result := public.flh_exam_submit(v_workspace,'96000000-0000-4000-8000-000000000098'::uuid,v_attempt_low);
  perform pg_temp.qa_exam_reward_assert(v_result->>'error'='ATTEMPT_NOT_ACTIVE','learner isolation');

  v_result := public.flh_exam_submit(v_workspace,v_learner,v_attempt_low);
  perform pg_temp.qa_exam_reward_assert(
    v_result->>'ok'='true'
    and (v_result->>'percentage')::numeric=0
    and (v_result->'award'->>'xp')::integer=10
    and (v_result->'award'->>'reward_points')::integer=0
    and (v_result->'award'->>'target_xp')::integer=10
    and (v_result->'award'->>'target_reward_points')::integer=0,
    'below-80 first award'
  );
  select xp,reward_points into v_xp,v_points
  from public.learner_gamification_state
  where workspace_id=v_workspace and learner_id=v_learner;
  perform pg_temp.qa_exam_reward_assert(v_xp=110 and v_points=20,'below-80 state delta');

  v_retry := public.flh_exam_submit(v_workspace,v_learner,v_attempt_low);
  perform pg_temp.qa_exam_reward_assert(v_retry=v_result,'duplicate submit returns cached result');

  perform pg_temp.qa_make_exam_attempt(v_learner,v_attempt_82,1,2,2);
  v_result := public.flh_exam_submit(v_workspace,v_learner,v_attempt_82);
  perform pg_temp.qa_exam_reward_assert(
    (v_result->>'percentage')::numeric=82
    and (v_result->'award'->>'xp')::integer=20
    and (v_result->'award'->>'reward_points')::integer=5
    and (v_result->'award'->>'target_xp')::integer=30
    and (v_result->'award'->>'target_reward_points')::integer=5,
    '82 percent delta'
  );

  perform pg_temp.qa_make_exam_attempt(v_learner,v_attempt_same,1,2,2);
  v_result := public.flh_exam_submit(v_workspace,v_learner,v_attempt_same);
  perform pg_temp.qa_exam_reward_assert(
    (v_result->'award'->>'xp')::integer=0
    and (v_result->'award'->>'reward_points')::integer=0
    and (v_result->'award'->>'already_awarded')::boolean
    and (v_result->'award'->>'no_increment')::boolean,
    'same tier no increment'
  );

  perform pg_temp.qa_make_exam_attempt(v_learner,v_attempt_92,1,1,2);
  v_result := public.flh_exam_submit(v_workspace,v_learner,v_attempt_92);
  perform pg_temp.qa_exam_reward_assert(
    (v_result->>'percentage')::numeric=92
    and (v_result->'award'->>'xp')::integer=20
    and (v_result->'award'->>'reward_points')::integer=5,
    '92 percent upgrade delta'
  );

  perform pg_temp.qa_make_exam_attempt(v_learner,v_attempt_100,1,1,1);
  v_result := public.flh_exam_submit(v_workspace,v_learner,v_attempt_100);
  perform pg_temp.qa_exam_reward_assert(
    (v_result->>'percentage')::numeric=100
    and (v_result->'award'->>'xp')::integer=25
    and (v_result->'award'->>'reward_points')::integer=5
    and (v_result->'award'->>'target_xp')::integer=75
    and (v_result->'award'->>'target_reward_points')::integer=15,
    '100 percent cap delta'
  );

  select xp,reward_points into v_xp,v_points
  from public.learner_gamification_state
  where workspace_id=v_workspace and learner_id=v_learner;
  perform pg_temp.qa_exam_reward_assert(v_xp=175 and v_points=35,'cumulative learner state capped');

  select count(*),coalesce(sum(xp_delta),0),coalesce(sum(reward_points_delta),0)
  into v_event_count,v_event_xp,v_event_points
  from public.gamification_events
  where workspace_id=v_workspace
    and learner_id=v_learner
    and event_type='quiz_completed'
    and source_type='exam'
    and source_id='qa-exam-reward-v12';

  perform pg_temp.qa_exam_reward_assert(
    v_event_count=4 and v_event_xp=75 and v_event_points=15,
    'ledger contains only positive Exam increments and reaches exact cap'
  );

  perform pg_temp.qa_exam_reward_assert(
    not exists(
      select 1 from public.gamification_events
      where workspace_id=v_workspace
        and learner_id=v_learner
        and source_type='quiz'
        and source_id='qa-exam-reward-v12'
    ),
    'Exam ledger source is distinct from Learning'
  );
end;
$contract$;

rollback;
