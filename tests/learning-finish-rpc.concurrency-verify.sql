do $verify$
declare
  v_workspace constant uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_quiz constant uuid := '94000000-0000-4000-8000-000000000001';
  v_attempt constant uuid := '94000000-0000-4000-8000-000000000004';
  v_learner uuid;
  v_subject bigint;
begin
  select id into strict v_learner from public.learners
  where workspace_id = v_workspace and slug = 'test';
  select subject_id into strict v_subject from public.quizzes where id = v_quiz;

  if not exists (
    select 1 from public.quiz_attempts
    where id = v_attempt and status = 'submitted' and score_points = 1
      and max_points = 1 and percentage = 100 and duration_seconds = 11
      and metadata->'learning_finish_last_result'->>'attempt_id' = v_attempt::text
  ) then raise exception 'LEARNING_FINISH_CONCURRENT_ATTEMPT_INVALID'; end if;
  if not exists (
    select 1 from public.learner_gamification_state
    where learner_id = v_learner and xp = 45 and reward_points = 10
      and current_streak = 1 and longest_streak = 1
  ) then raise exception 'LEARNING_FINISH_CONCURRENT_GAMIFICATION_DUPLICATED'; end if;
  if (select count(*) from public.gamification_events
      where learner_id = v_learner and event_type = 'quiz_completed'
        and source_id like 'qa-learning-finish-concurrency:test:%'
        and xp_delta = 45 and reward_points_delta = 10) <> 1 then
    raise exception 'LEARNING_FINISH_CONCURRENT_EVENT_DUPLICATED';
  end if;
  if (select count(*) from public.learner_badges lb
      join public.gamification_badges badge on badge.id = lb.badge_id
      where lb.learner_id = v_learner and badge.code = 'concept-master') <> 1 then
    raise exception 'LEARNING_FINISH_CONCURRENT_BADGE_DUPLICATED';
  end if;

  delete from public.quiz_attempts where id = v_attempt;
  delete from public.gamification_events
  where learner_id = v_learner and source_id like 'qa-learning-finish-concurrency%';
  delete from public.learner_badges
  using public.gamification_badges badge
  where learner_badges.badge_id = badge.id
    and learner_badges.learner_id = v_learner
    and badge.code = 'concept-master';
  delete from public.learner_gamification_state
  where learner_id = v_learner and workspace_id = v_workspace;
  delete from public.quizzes where id = v_quiz;
  delete from public.subjects where id = v_subject;
end;
$verify$;
