-- FLH-FEAT-2026-010 v1.2
-- Exam Mode mastery rewards.
-- Forward-only: Learning rewards remain unchanged and paper Exam ingestion keeps
-- its existing reward-neutral behavior.

create or replace function public.flh_exam_reward_target(p_percentage numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select case
    when coalesce(p_percentage, 0) < 80
      then jsonb_build_object('xp', 10, 'reward_points', 0)
    when p_percentage < 85
      then jsonb_build_object('xp', 30, 'reward_points', 5)
    when p_percentage < 90
      then jsonb_build_object('xp', 40, 'reward_points', 7)
    when p_percentage < 95
      then jsonb_build_object('xp', 50, 'reward_points', 10)
    when p_percentage < 100
      then jsonb_build_object('xp', 60, 'reward_points', 12)
    else jsonb_build_object('xp', 75, 'reward_points', 15)
  end;
$function$;

revoke all on function public.flh_exam_reward_target(numeric) from public;
revoke all on function public.flh_exam_reward_target(numeric) from anon, authenticated;
grant execute on function public.flh_exam_reward_target(numeric) to service_role;

create or replace function public.flh_exam_submit(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_cached_result jsonb;
  v_queue_count integer := 0;
  v_answer_count integer := 0;
  v_score numeric := 0;
  v_max numeric := 0;
  v_percentage numeric := 0;
  v_flagged_count integer := 0;
  v_duration integer := 1;
  v_review jsonb := '[]'::jsonb;
  v_quiz_id uuid;
  v_quiz_slug text;
  v_quiz_title text;
  v_is_paper boolean := false;
  v_target jsonb := '{}'::jsonb;
  v_target_xp integer := 0;
  v_target_reward_points integer := 0;
  v_prior_xp integer := 0;
  v_prior_reward_points integer := 0;
  v_xp_delta integer := 0;
  v_reward_points_delta integer := 0;
  v_old_xp integer := 0;
  v_old_reward_points integer := 0;
  v_new_xp integer := 0;
  v_new_reward_points integer := 0;
  v_new_level integer := 1;
  v_award jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  if p_workspace_id is null or p_learner_id is null or p_attempt_id is null then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the attempt first. A duplicate submit waits, then returns the first
  -- transaction's cached result instead of grading or awarding twice.
  select a.*
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.id = p_attempt_id
    and a.learner_id = p_learner_id
  limit 1
  for update;

  if not found or v_attempt.delivery_mode <> 'exam' then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status = 'submitted' then
    v_cached_result := v_attempt.metadata->'exam_submit_last_result';
    if jsonb_typeof(v_cached_result) = 'object' then
      return v_cached_result;
    end if;
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  -- Serialize all academic/family balance mutations for one learner on the
  -- same learner row used by Learning and family reward commands.
  perform 1
  from public.learners l
  where l.workspace_id = p_workspace_id
    and l.id = p_learner_id
    and l.is_active
  for update;

  if not found then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  select q.id, q.slug, q.title
    into v_quiz_id, v_quiz_slug, v_quiz_title
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id = v.workspace_id
   and q.id = v.quiz_id
  where v.workspace_id = p_workspace_id
    and v.id = v_attempt.quiz_version_id
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'EXAM_SUBMIT_QUIZ_METADATA_MISSING';
  end if;

  select count(*) into v_queue_count
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id;

  -- Missing rows remain missing here. Paper-only blank materialization is performed
  -- by flh_paper_exam_submit after an exact declared-blank/missing-set match.
  select count(*) into v_answer_count
  from public.quiz_attempt_answers aa
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id = aa.workspace_id
   and qq.quiz_attempt_id = aa.attempt_id
   and qq.question_id = aa.question_id
  where aa.workspace_id = p_workspace_id
    and aa.attempt_id = p_attempt_id;

  if v_queue_count = 0 or v_answer_count <> v_queue_count then
    return jsonb_build_object('error','EXAM_NOT_COMPLETE');
  end if;

  update public.quiz_attempt_answers aa
  set evaluation = case
        when aa.response = '{"unanswered":true}'::jsonb then 'incorrect'
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then 'correct'
        else 'incorrect'
      end,
      is_correct = case
        when aa.response = '{"unanswered":true}'::jsonb then false
        else (
          nullif(aa.response->>'option_position','')::integer =
          nullif(k.correct_answer->>'option_position','')::integer
        )
      end,
      points_awarded = case
        when aa.response = '{"unanswered":true}'::jsonb then 0
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then coalesce(q.points,1)
        else 0
      end,
      first_try_correct = case
        when aa.response = '{"unanswered":true}'::jsonb then false
        else (
          nullif(aa.response->>'option_position','')::integer =
          nullif(k.correct_answer->>'option_position','')::integer
        )
      end,
      mastery_result = case
        when aa.response = '{"unanswered":true}'::jsonb then 'not_mastered'
        when nullif(aa.response->>'option_position','')::integer =
             nullif(k.correct_answer->>'option_position','')::integer then 'mastered'
        else 'not_mastered'
      end
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.workspace_id = qq.workspace_id
   and q.id = qq.question_id
  join public.quiz_question_answer_keys k
    on k.workspace_id = q.workspace_id
   and k.question_id = q.id
  where aa.workspace_id = p_workspace_id
    and aa.attempt_id = p_attempt_id
    and qq.workspace_id = aa.workspace_id
    and qq.quiz_attempt_id = aa.attempt_id
    and qq.question_id = aa.question_id;

  select
    coalesce(sum(case when aa.is_correct then coalesce(q.points,1) else 0 end),0),
    coalesce(sum(coalesce(q.points,1)),0),
    count(*) filter (where coalesce(qq.is_flagged,false)),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'question_id', q.id,
        'question_code', q.question_code,
        'prompt', q.prompt,
        'prompt_language', q.prompt_language,
        'response', aa.response,
        'is_correct', coalesce(aa.is_correct,false),
        'was_flagged', coalesce(qq.is_flagged,false),
        'correct_answer', k.correct_answer,
        'explanation', case
          when aa.is_correct then coalesce(nullif(k.correct_explanation,''), nullif(k.explanation,''))
          else coalesce(nullif(k.final_incorrect_explanation,''), nullif(k.explanation,''))
        end,
        'hints', coalesce((
          select jsonb_agg(jsonb_build_object(
            'hint_level', h.hint_level,
            'pedagogical_role', h.pedagogical_role,
            'content', h.content
          ) order by h.hint_level)
          from public.quiz_question_hints h
          where h.workspace_id = p_workspace_id
            and h.question_id = q.id
        ), '[]'::jsonb)
      ) order by qq.sequence_no
    ), '[]'::jsonb)
  into v_score, v_max, v_flagged_count, v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.workspace_id = qq.workspace_id
   and q.id = qq.question_id
  join public.quiz_attempt_answers aa
    on aa.workspace_id = qq.workspace_id
   and aa.attempt_id = qq.quiz_attempt_id
   and aa.question_id = qq.question_id
  join public.quiz_question_answer_keys k
    on k.workspace_id = q.workspace_id
   and k.question_id = q.id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id;

  v_percentage := case
    when v_max > 0 then round((v_score / v_max) * 100, 2)
    else 0
  end;

  v_duration := greatest(
    1,
    round(extract(epoch from (clock_timestamp() - v_attempt.started_at)))::integer
  );

  v_is_paper := nullif(v_attempt.metadata->>'paper_model_code','') is not null;

  if v_is_paper then
    -- Paper ingestion is intentionally outside this digital Exam reward change.
    v_award := jsonb_build_object(
      'eligible', false,
      'reason', 'paper_exam_unchanged',
      'already_awarded', false,
      'no_increment', true,
      'xp', 0,
      'reward_points', 0
    );
  else
    v_target := public.flh_exam_reward_target(v_percentage);
    v_target_xp := coalesce((v_target->>'xp')::integer,0);
    v_target_reward_points := coalesce((v_target->>'reward_points')::integer,0);

    select
      coalesce(sum(e.xp_delta),0)::integer,
      coalesce(sum(e.reward_points_delta),0)::integer
    into v_prior_xp, v_prior_reward_points
    from public.gamification_events e
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.event_type = 'quiz_completed'
      and e.source_type = 'exam'
      and e.source_id = v_quiz_id::text;

    v_xp_delta := greatest(0, v_target_xp - v_prior_xp);
    v_reward_points_delta := greatest(0, v_target_reward_points - v_prior_reward_points);

    if v_xp_delta > 0 or v_reward_points_delta > 0 then
      select s.xp, s.reward_points
      into v_old_xp, v_old_reward_points
      from public.learner_gamification_state s
      where s.workspace_id = p_workspace_id
        and s.learner_id = p_learner_id;

      if not found then
        v_old_xp := 0;
        v_old_reward_points := 0;
      end if;

      v_new_xp := v_old_xp + v_xp_delta;
      v_new_reward_points := v_old_reward_points + v_reward_points_delta;

      select gl.level_no
      into v_new_level
      from public.gamification_levels gl
      where gl.workspace_id = p_workspace_id
        and gl.min_xp <= v_new_xp
      order by gl.min_xp desc
      limit 1;
      v_new_level := coalesce(v_new_level, 1);

      insert into public.learner_gamification_state as state(
        workspace_id,
        learner_id,
        xp,
        reward_points,
        current_level,
        current_streak,
        longest_streak
      ) values (
        p_workspace_id,
        p_learner_id,
        v_new_xp,
        v_new_reward_points,
        v_new_level,
        0,
        0
      )
      on conflict (learner_id) do update
      set xp = excluded.xp,
          reward_points = excluded.reward_points,
          current_level = excluded.current_level;

      insert into public.gamification_events(
        workspace_id,
        learner_id,
        event_type,
        xp_delta,
        reward_points_delta,
        source_type,
        source_id,
        reason,
        metadata
      ) values (
        p_workspace_id,
        p_learner_id,
        'quiz_completed',
        v_xp_delta,
        v_reward_points_delta,
        'exam',
        v_quiz_id::text,
        'Server-graded Exam mastery reward',
        jsonb_build_object(
          'attempt_id', p_attempt_id,
          'quiz_id', v_quiz_id,
          'quiz_slug', v_quiz_slug,
          'percentage', v_percentage,
          'target_xp', v_target_xp,
          'target_reward_points', v_target_reward_points,
          'prior_exam_xp', v_prior_xp,
          'prior_exam_reward_points', v_prior_reward_points,
          'reward_policy', 'exam-mastery-v1.2',
          'engine', 'exam-v2-api-v5'
        )
      );
    end if;

    v_award := jsonb_build_object(
      'eligible', true,
      'already_awarded', (v_xp_delta = 0 and v_reward_points_delta = 0),
      'no_increment', (v_xp_delta = 0 and v_reward_points_delta = 0),
      'xp', v_xp_delta,
      'reward_points', v_reward_points_delta,
      'target_xp', v_target_xp,
      'target_reward_points', v_target_reward_points,
      'prior_exam_xp', v_prior_xp,
      'prior_exam_reward_points', v_prior_reward_points
    );
  end if;

  v_result := jsonb_build_object(
    'ok',true,
    'attempt_id',p_attempt_id,
    'quiz',jsonb_build_object('slug',v_quiz_slug,'title',v_quiz_title),
    'score_points',v_score,
    'max_points',v_max,
    'percentage',v_percentage,
    'award',v_award,
    'review',v_review
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = clock_timestamp(),
      score_points = v_score,
      max_points = v_max,
      percentage = v_percentage,
      duration_seconds = v_duration,
      metadata = coalesce(v_attempt.metadata,'{}'::jsonb) || jsonb_build_object(
        'engine','exam-v2-api-v5',
        'server_graded',true,
        'question_count',v_queue_count,
        'flagged_count',v_flagged_count,
        'exam_reward_policy',case when v_is_paper then 'paper-unchanged' else 'exam-mastery-v1.2' end,
        'exam_submit_last_result',v_result
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id
    and learner_id = p_learner_id
    and status = 'in_progress';

  update public.quiz_attempt_question_queue
  set status = 'completed'
  where workspace_id = p_workspace_id
    and quiz_attempt_id = p_attempt_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from public;
revoke all on function public.flh_exam_submit(uuid,uuid,uuid) from anon, authenticated;
grant execute on function public.flh_exam_submit(uuid,uuid,uuid) to service_role;
