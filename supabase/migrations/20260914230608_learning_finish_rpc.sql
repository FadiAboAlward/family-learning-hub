-- Consolidate Learning Mode finish into one atomic, server-authoritative call.
-- The Edge Function authenticates the custom learner HMAC session and invokes
-- this function with service_role. No elevated definer privileges are needed.
create or replace function public.flh_learning_finish(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_quiz record;
  v_learner_is_test boolean := false;
  v_cached_result jsonb;
  v_score_points numeric := 0;
  v_max_points numeric := 0;
  v_percentage numeric := 0;
  v_first_try_correct integer := 0;
  v_hints_used integer := 0;
  v_duration_seconds integer := 0;
  v_submitted_at timestamptz := now();
  v_review jsonb := '[]'::jsonb;
  v_award jsonb;
  v_result jsonb;
  v_prior_award boolean := false;
  v_xp_award integer := 25;
  v_reward_points_award integer := 5;
  v_old_xp integer := 0;
  v_old_reward_points integer := 0;
  v_old_current_streak integer := 0;
  v_old_longest_streak integer := 0;
  v_old_last_learning_date date;
  v_new_xp integer;
  v_new_reward_points integer;
  v_new_level integer := 1;
  v_new_streak integer := 1;
  v_today date := (now() at time zone 'UTC')::date;
  v_yesterday date := ((now() at time zone 'UTC')::date - 1);
  v_badge_codes text[] := array[]::text[];
  v_badge_code text;
  v_badge_id uuid;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_attempt_id is null then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the attempt first, matching the Learning answer lock order. A second
  -- finish waits here, then returns the first transaction's cached response.
  select a.*
  into v_attempt
  from public.quiz_attempts a
  where a.id = p_attempt_id
    and a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
  for update;

  if not found or v_attempt.delivery_mode <> 'learning' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status = 'submitted' then
    v_cached_result := v_attempt.metadata->'learning_finish_last_result';
    if jsonb_typeof(v_cached_result) = 'object' then
      return v_cached_result;
    end if;
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  -- Lock the learner after the attempt. This validates active ownership and
  -- serializes gamification awards across different attempts by one learner.
  select coalesce((l.metadata->>'is_test')::boolean, false)
  into v_learner_is_test
  from public.learners l
  where l.id = p_learner_id
    and l.workspace_id = p_workspace_id
    and l.is_active
  for update;

  if not found then
    return jsonb_build_object('error', 'ATTEMPT_NOT_ACTIVE');
  end if;

  if exists (
    select 1
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = p_attempt_id
      and qq.status in ('pending', 'active')
  ) then
    return jsonb_build_object('error', 'QUIZ_NOT_COMPLETE');
  end if;

  select qz.slug, qz.title
  into v_quiz
  from public.quiz_versions qv
  join public.quizzes qz
    on qz.id = qv.quiz_id
   and qz.workspace_id = qv.workspace_id
  where qv.id = v_attempt.quiz_version_id
    and qv.workspace_id = p_workspace_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'LEARNING_FINISH_QUIZ_METADATA_MISSING';
  end if;

  -- Score only the original core-question set. Remediation remains learning
  -- evidence but does not change the current completion score denominator.
  select
    coalesce(sum(q.points), 0),
    coalesce(sum(a.points_awarded), 0),
    count(*) filter (where a.first_try_correct)::integer,
    coalesce(sum(a.hints_used), 0)::integer
  into
    v_max_points,
    v_score_points,
    v_first_try_correct,
    v_hints_used
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  v_percentage := case
    when v_max_points > 0 then round(v_score_points / v_max_points * 100, 2)
    else 0
  end;

  v_duration_seconds := case
    when coalesce(p_duration_seconds, 0) > 0
      then greatest(0, least(86400, p_duration_seconds))
    else greatest(0, least(86400, round(extract(epoch from (v_submitted_at - v_attempt.started_at)))::integer))
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'question_id', a.question_id,
      'question_code', q.question_code,
      'prompt', q.prompt,
      'response', a.response,
      'is_correct', a.is_correct,
      'correct_answer', k.correct_answer,
      'explanation', case
        when a.is_correct then coalesce(k.correct_explanation, k.explanation)
        else coalesce(k.final_incorrect_explanation, k.explanation)
      end
    ) order by qq.sequence_no
  ), '[]'::jsonb)
  into v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_attempt_answers a
    on a.attempt_id = qq.quiz_attempt_id
   and a.question_id = qq.question_id
   and a.workspace_id = qq.workspace_id
  join public.quiz_questions q
    on q.id = qq.question_id
   and q.workspace_id = qq.workspace_id
  left join public.quiz_question_answer_keys k
    on k.question_id = qq.question_id
   and k.workspace_id = qq.workspace_id
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id
    and qq.source_role = 'core';

  -- Test learners deliberately receive repeatable per-attempt QA awards; the
  -- existing trigger rewrites their source_id. Production learners retain the
  -- current once-per-quiz award behavior.
  select exists (
    select 1
    from public.gamification_events e
    where e.workspace_id = p_workspace_id
      and e.learner_id = p_learner_id
      and e.event_type = 'quiz_completed'
      and e.source_type = 'quiz'
      and e.source_id = v_quiz.slug
  ) into v_prior_award;

  if v_prior_award then
    v_award := jsonb_build_object(
      'already_awarded', true,
      'xp', 0,
      'reward_points', 0,
      'badges', '[]'::jsonb
    );
  else
    if v_percentage >= 70 then
      v_xp_award := v_xp_award + 20;
      v_reward_points_award := v_reward_points_award + 5;
    end if;
    if v_first_try_correct >= 2 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'first-try');
    end if;
    if v_hints_used >= 2 and v_percentage >= 40 then
      v_xp_award := v_xp_award + 10;
      v_badge_codes := array_append(v_badge_codes, 'keep-going');
    end if;
    if v_percentage >= 85 then
      v_badge_codes := array_append(v_badge_codes, 'concept-master');
    end if;

    select
      s.xp,
      s.reward_points,
      s.current_streak,
      s.longest_streak,
      s.last_learning_date
    into
      v_old_xp,
      v_old_reward_points,
      v_old_current_streak,
      v_old_longest_streak,
      v_old_last_learning_date
    from public.learner_gamification_state s
    where s.workspace_id = p_workspace_id
      and s.learner_id = p_learner_id;

    if not found then
      v_old_xp := 0;
      v_old_reward_points := 0;
      v_old_current_streak := 0;
      v_old_longest_streak := 0;
      v_old_last_learning_date := null;
    end if;

    v_new_xp := v_old_xp + v_xp_award;
    v_new_reward_points := v_old_reward_points + v_reward_points_award;
    v_new_streak := case
      when v_old_last_learning_date = v_today then v_old_current_streak
      when v_old_last_learning_date = v_yesterday then v_old_current_streak + 1
      else 1
    end;

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
      longest_streak,
      last_learning_date
    ) values (
      p_workspace_id,
      p_learner_id,
      v_new_xp,
      v_new_reward_points,
      v_new_level,
      v_new_streak,
      greatest(v_old_longest_streak, v_new_streak),
      v_today
    )
    on conflict (learner_id) do update
    set xp = excluded.xp,
        reward_points = excluded.reward_points,
        current_level = excluded.current_level,
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        last_learning_date = excluded.last_learning_date;

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
      v_xp_award,
      v_reward_points_award,
      'quiz',
      v_quiz.slug,
      'Server-graded quiz completion',
      jsonb_build_object(
        'percentage', v_percentage,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'engine', 'learning-api-v2'
      )
    );

    foreach v_badge_code in array v_badge_codes loop
      select b.id
      into v_badge_id
      from public.gamification_badges b
      where b.workspace_id = p_workspace_id
        and b.code = v_badge_code;

      if found then
        insert into public.learner_badges(
          workspace_id,
          learner_id,
          badge_id,
          award_reason,
          metadata
        ) values (
          p_workspace_id,
          p_learner_id,
          v_badge_id,
          'quiz:' || v_quiz.slug,
          jsonb_build_object('percentage', v_percentage)
        )
        on conflict (learner_id, badge_id) do nothing;
      end if;
    end loop;

    v_award := jsonb_build_object(
      'already_awarded', false,
      'xp', v_xp_award,
      'reward_points', v_reward_points_award,
      'badges', to_jsonb(v_badge_codes)
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'attempt_id', p_attempt_id,
    'quiz', jsonb_build_object('slug', v_quiz.slug, 'title', v_quiz.title),
    'score_points', v_score_points,
    'max_points', v_max_points,
    'percentage', v_percentage,
    'first_try_correct', v_first_try_correct,
    'hints_used', v_hints_used,
    'award', v_award,
    'review', v_review
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = v_submitted_at,
      score_points = v_score_points,
      max_points = v_max_points,
      percentage = v_percentage,
      duration_seconds = v_duration_seconds,
      metadata = coalesce(v_attempt.metadata, '{}'::jsonb) || jsonb_build_object(
        'engine', 'learning-api-v2',
        'server_graded', true,
        'first_try_correct', v_first_try_correct,
        'hints_used', v_hints_used,
        'learning_finish_last_result', v_result
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id
    and learner_id = p_learner_id;

  return v_result;
end;
$function$;

revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from public;
revoke all on function public.flh_learning_finish(uuid,uuid,uuid,integer) from anon, authenticated;
grant execute on function public.flh_learning_finish(uuid,uuid,uuid,integer) to service_role;

comment on function public.flh_learning_finish(uuid,uuid,uuid,integer) is
  'Atomically finishes one Learning attempt, including scoring, gamification, badges, and review. Service-role only; Edge authenticates the custom learner HMAC session.';
