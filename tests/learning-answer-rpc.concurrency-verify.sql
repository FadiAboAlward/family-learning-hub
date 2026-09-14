do $verify$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_quiz constant uuid := '40000000-0000-4000-8000-000000000001';
  v_concept constant uuid := '40000000-0000-4000-8000-000000000003';
  v_question constant uuid := '40000000-0000-4000-8000-000000000004';
  v_next_question constant uuid := '40000000-0000-4000-8000-000000000005';
  v_attempt constant uuid := '50000000-0000-4000-8000-000000000001';
  v_subject bigint;
begin
  select subject_id into strict v_subject from public.quizzes where id = v_quiz;

  if (select count(*) from public.quiz_answer_attempts where quiz_attempt_id = v_attempt and question_id = v_question) <> 1
     or (select count(*) from public.quiz_attempt_answers where attempt_id = v_attempt and question_id = v_question) <> 1
     or not exists (
       select 1 from public.quiz_attempt_answers
       where attempt_id = v_attempt and question_id = v_question
         and is_correct and attempts_used = 1 and first_try_correct
     ) then
    raise exception 'LEARNING_RPC_CONCURRENT_ANSWER_DUPLICATED';
  end if;

  if not exists (
    select 1
    from public.learner_concept_mastery
    where concept_id = v_concept
      and mastery_score = 100
      and evidence_count = 1
      and first_try_correct_count = 1
      and total_question_count = 1
  ) then
    raise exception 'LEARNING_RPC_CONCURRENT_MASTERY_DUPLICATED';
  end if;

  if not exists (
    select 1
    from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt
      and question_id = v_question
      and status = 'completed'
      and interaction_metadata->'learning_answer_last_result'->>'attempt_no' = '1'
  ) or not exists (
    select 1 from public.quiz_attempt_question_queue
    where quiz_attempt_id = v_attempt and question_id = v_next_question and status = 'active'
  ) or (select count(*) from public.quiz_attempt_question_queue where quiz_attempt_id = v_attempt and status = 'active') <> 1
     or exists (
       select 1 from public.quiz_attempt_question_queue
       where quiz_attempt_id = v_attempt and status = 'pending'
  ) then
    raise exception 'LEARNING_RPC_CONCURRENT_QUEUE_INVALID';
  end if;

  delete from public.quiz_attempts where id = v_attempt;
  delete from public.quizzes where id = v_quiz;
  delete from public.learning_concepts where id = v_concept;
  delete from public.subjects where id = v_subject;
end;
$verify$;
