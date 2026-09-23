-- FLH-FEAT-2026-003 v1.0
-- Preserve genuinely unanswered printed questions during paper-exam ingestion
-- without inventing an option. Interactive Exam behavior remains unchanged.


-- Fresh rebuilds must also reconstruct the current production Exam save RPC.
-- This is intentionally behavior-preserving: Production already has this exact
-- signature/semantics, while historical mirror migrations are identity-only.
create or replace function public.flh_exam_save_answer(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_option_position integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_option_position is null or p_option_position < 1 then
    return jsonb_build_object('error','INVALID_ANSWER');
  end if;

  if not exists (
    select 1
    from public.quiz_attempts a
    join public.quiz_attempt_question_queue q
      on q.quiz_attempt_id = a.id
     and q.workspace_id = a.workspace_id
     and q.question_id = p_question_id
    where a.workspace_id = p_workspace_id
      and a.id = p_attempt_id
      and a.learner_id = p_learner_id
      and a.status = 'in_progress'
      and a.delivery_mode = 'exam'
  ) then
    return jsonb_build_object('error','ATTEMPT_OR_QUESTION_NOT_ACTIVE');
  end if;

  insert into public.quiz_attempt_answers (
    workspace_id, attempt_id, question_id, response, evaluation,
    is_correct, points_awarded, answered_at, attempts_used, hints_used,
    first_try_correct, mastery_result
  ) values (
    p_workspace_id, p_attempt_id, p_question_id,
    jsonb_build_object('option_position', p_option_position),
    'ungraded', null, null, now(), 1, 0, null, null
  )
  on conflict (attempt_id, question_id) do update set
    response = excluded.response,
    evaluation = 'ungraded',
    is_correct = null,
    points_awarded = null,
    answered_at = now(),
    attempts_used = 1,
    hints_used = 0,
    first_try_correct = null,
    mastery_result = null;

  return jsonb_build_object('ok',true,'option_position',p_option_position);
end;
$function$;

-- Preserve the historical 1..10 interaction invariant while allowing exactly one
-- non-interactive representation: an explicitly unanswered paper response.
alter table public.quiz_attempt_answers
  drop constraint if exists quiz_attempt_answers_attempts_used_check;

alter table public.quiz_attempt_answers
  add constraint quiz_attempt_answers_attempts_used_check
  check (
    attempts_used between 1 and 10
    or (
      attempts_used = 0
      and response = '{"unanswered":true}'::jsonb
    )
  );

revoke all on function public.flh_exam_save_answer(uuid,uuid,uuid,uuid,integer) from public;
revoke all on function public.flh_exam_save_answer(uuid,uuid,uuid,uuid,integer) from anon, authenticated;
grant execute on function public.flh_exam_save_answer(uuid,uuid,uuid,uuid,integer) to service_role;

create or replace function public.flh_guard_paper_attempt_answer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_paper jsonb;
  v_entry jsonb;
  v_validation jsonb;
  v_option_position integer;
begin
  select quiz_version_id,metadata into v_attempt
  from public.quiz_attempts
  where workspace_id=new.workspace_id and id=new.attempt_id
  limit 1;

  if not found or nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return new;
  end if;

  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_NOT_VALIDATED';
  end if;

  v_validation := public.flh_paper_exam_validate_queue(new.workspace_id,new.attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;

  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id=new.workspace_id
    and id=v_attempt.quiz_version_id
    and state='published';

  select value into v_entry
  from jsonb_each(v_paper->'paper_question_map')
  where value->>'question_id'=new.question_id::text
  limit 1;

  if v_entry is null then
    raise exception 'PAPER_QUESTION_NOT_MAPPED';
  end if;

  -- A blank printed response is a first-class paper response, never a fake option.
  -- Keep the representation exact so extra/contradictory fields fail closed.
  if new.response = '{"unanswered":true}'::jsonb then
    if coalesce(new.attempts_used,0) <> 0 or coalesce(new.hints_used,0) <> 0 then
      raise exception 'PAPER_UNANSWERED_INTERACTION_INVALID';
    end if;
    return new;
  end if;

  if new.response ? 'unanswered' then
    raise exception 'PAPER_ANSWER_INVALID';
  end if;

  begin
    v_option_position := nullif(new.response->>'option_position','')::integer;
  exception when others then
    raise exception 'PAPER_ANSWER_INVALID';
  end;

  if v_option_position is null or not exists (
    select 1
    from jsonb_each_text(v_entry->'option_positions') p
    where p.value ~ '^[1-9][0-9]*$'
      and p.value::integer=v_option_position
  ) then
    raise exception 'PAPER_OPTION_NOT_MAPPED';
  end if;

  return new;
end;
$function$;

revoke all on function public.flh_guard_paper_attempt_answer() from public;
revoke all on function public.flh_guard_paper_attempt_answer() from anon, authenticated;


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
  v_attempt record;
  v_queue_count integer := 0;
  v_answer_count integer := 0;
  v_score numeric := 0;
  v_max numeric := 0;
  v_flagged_count integer := 0;
  v_duration integer := 1;
  v_review jsonb := '[]'::jsonb;
  v_quiz jsonb := '{}'::jsonb;
  v_is_paper boolean := false;
begin
  select a.id, a.quiz_version_id, a.started_at, a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.id = p_attempt_id
    and a.learner_id = p_learner_id
    and a.status = 'in_progress'
    and a.delivery_mode = 'exam'
  limit 1;

  if not found then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  v_is_paper := nullif(v_attempt.metadata->>'paper_model_code','') is not null;

  select count(*) into v_queue_count
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = p_workspace_id
    and qq.quiz_attempt_id = p_attempt_id;

  -- Paper is an alternate delivery surface. A visibly blank printed question
  -- must be represented explicitly rather than blocking submission or forcing
  -- a fabricated option. The paper answer guard validates each inserted row.
  if v_is_paper then
    insert into public.quiz_attempt_answers (
      workspace_id, attempt_id, question_id, response, evaluation,
      is_correct, points_awarded, answered_at, attempts_used, hints_used,
      first_try_correct, mastery_result
    )
    select
      qq.workspace_id,
      qq.quiz_attempt_id,
      qq.question_id,
      '{"unanswered":true}'::jsonb,
      'ungraded',
      null,
      null,
      clock_timestamp(),
      0,
      0,
      null,
      null
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = p_attempt_id
      and not exists (
        select 1
        from public.quiz_attempt_answers aa
        where aa.workspace_id = qq.workspace_id
          and aa.attempt_id = qq.quiz_attempt_id
          and aa.question_id = qq.question_id
      );
  end if;

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

  v_duration := greatest(
    1,
    round(extract(epoch from (clock_timestamp() - v_attempt.started_at)))::integer
  );

  update public.quiz_attempts
  set status = 'submitted',
      submitted_at = clock_timestamp(),
      score_points = v_score,
      max_points = v_max,
      percentage = case when v_max > 0 then round((v_score / v_max) * 100, 2) else 0 end,
      duration_seconds = v_duration,
      metadata = coalesce(v_attempt.metadata,'{}'::jsonb) || jsonb_build_object(
        'engine','exam-v2-api-v5',
        'server_graded',true,
        'question_count',v_queue_count,
        'flagged_count',v_flagged_count
      )
  where id = p_attempt_id
    and workspace_id = p_workspace_id;

  update public.quiz_attempt_question_queue
  set status = 'completed'
  where workspace_id = p_workspace_id
    and quiz_attempt_id = p_attempt_id;

  select jsonb_build_object('slug',q.slug,'title',q.title)
    into v_quiz
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id = v.workspace_id
   and q.id = v.quiz_id
  where v.workspace_id = p_workspace_id
    and v.id = v_attempt.quiz_version_id
  limit 1;

  return jsonb_build_object(
    'ok',true,
    'attempt_id',p_attempt_id,
    'quiz',coalesce(v_quiz,'{}'::jsonb),
    'score_points',v_score,
    'max_points',v_max,
    'percentage',case when v_max > 0 then round((v_score / v_max) * 100, 2) else 0 end,
    'review',v_review
  );
end;
$function$;
