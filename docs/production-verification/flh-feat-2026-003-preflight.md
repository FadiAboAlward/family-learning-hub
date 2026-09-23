# FLH-FEAT-2026-003 — Production preflight verification

Captured before applying the migration to Production on 2026-09-23.

## Purpose

This record captures the live Production definitions that the forward migration replaces or extends. It is a pre-deployment safety record, not a historical migration rewrite.

## Commands executed against Production

```sql
select pg_get_functiondef('public.flh_exam_save_answer(uuid,uuid,uuid,uuid,integer)'::regprocedure);
select pg_get_functiondef('public.flh_exam_submit(uuid,uuid,uuid)'::regprocedure);
```

## Production: flh_exam_save_answer

Signature: `flh_exam_save_answer(uuid,uuid,uuid,uuid,integer)`

ACL at preflight: `{postgres=X/postgres,service_role=X/postgres}`

```sql
CREATE OR REPLACE FUNCTION public.flh_exam_save_answer(p_workspace_id uuid, p_learner_id uuid, p_attempt_id uuid, p_question_id uuid, p_option_position integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
```

### Comparison against the migration replacement

The captured Production body is the baseline above. The migration initially reconstructed it byte-for-behavior, then the review identified a save-vs-submit race. The final forward migration intentionally differs in one concurrency-safe way: `flh_exam_save_answer` locks the matching `quiz_attempts` row with `FOR UPDATE` before re-checking that the attempt is still `in_progress` and before touching `quiz_attempt_answers`.

This preserves normal save semantics while preventing a racing save from resetting an answer to `ungraded` after submission has graded and finalized the attempt. A deterministic two-session regression test covers this exact race.

## Production: flh_exam_submit

Signature: `flh_exam_submit(uuid,uuid,uuid)`

ACL at preflight: `{postgres=X/postgres,service_role=X/postgres}`

```sql
CREATE OR REPLACE FUNCTION public.flh_exam_submit(p_workspace_id uuid, p_learner_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if not found then return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE'); end if;

  select count(*) into v_queue_count
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = p_workspace_id and qq.quiz_attempt_id = p_attempt_id;

  select count(*) into v_answer_count
  from public.quiz_attempt_answers aa
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id = aa.workspace_id
   and qq.quiz_attempt_id = aa.attempt_id
   and qq.question_id = aa.question_id
  where aa.workspace_id = p_workspace_id and aa.attempt_id = p_attempt_id;

  if v_queue_count = 0 or v_answer_count <> v_queue_count then
    return jsonb_build_object('error','EXAM_NOT_COMPLETE');
  end if;

  update public.quiz_attempt_answers aa
  set evaluation = case when nullif(aa.response->>'option_position','')::integer = nullif(k.correct_answer->>'option_position','')::integer then 'correct' else 'incorrect' end,
      is_correct = (nullif(aa.response->>'option_position','')::integer = nullif(k.correct_answer->>'option_position','')::integer),
      points_awarded = case when nullif(aa.response->>'option_position','')::integer = nullif(k.correct_answer->>'option_position','')::integer then coalesce(q.points,1) else 0 end,
      first_try_correct = (nullif(aa.response->>'option_position','')::integer = nullif(k.correct_answer->>'option_position','')::integer),
      mastery_result = case when nullif(aa.response->>'option_position','')::integer = nullif(k.correct_answer->>'option_position','')::integer then 'mastered' else 'not_mastered' end
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q on q.workspace_id = qq.workspace_id and q.id = qq.question_id
  join public.quiz_question_answer_keys k on k.workspace_id = q.workspace_id and k.question_id = q.id
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
  join public.quiz_questions q on q.workspace_id = qq.workspace_id and q.id = qq.question_id
  join public.quiz_attempt_answers aa on aa.workspace_id = qq.workspace_id and aa.attempt_id = qq.quiz_attempt_id and aa.question_id = qq.question_id
  join public.quiz_question_answer_keys k on k.workspace_id = q.workspace_id and k.question_id = q.id
  where qq.workspace_id = p_workspace_id and qq.quiz_attempt_id = p_attempt_id;

  v_duration := greatest(1, round(extract(epoch from (clock_timestamp() - v_attempt.started_at)))::integer);

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
  where id = p_attempt_id and workspace_id = p_workspace_id;

  update public.quiz_attempt_question_queue
  set status = 'completed'
  where workspace_id = p_workspace_id and quiz_attempt_id = p_attempt_id;

  select jsonb_build_object('slug',q.slug,'title',q.title)
    into v_quiz
  from public.quiz_versions v
  join public.quizzes q on q.workspace_id = v.workspace_id and q.id = v.quiz_id
  where v.workspace_id = p_workspace_id and v.id = v_attempt.quiz_version_id
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
$function$
```

### Comparison against the migration replacement

The replacement is intentionally **not byte-identical** because FLH-FEAT-2026-003 changes the paper path and review hardening adds compatible concurrency controls while preserving interactive Exam semantics. The reviewed delta is limited to:

- lock the active attempt row with `FOR UPDATE` in submit and require `status = 'in_progress'` again on the final attempt update;
- lock the same active attempt row in answer-save before its status re-check/upsert, serializing save-vs-submit races;
- grade an already validated explicit `{"unanswered": true}` paper row as incorrect / zero points / not mastered;
- keep missing rows strict inside generic `flh_exam_submit`; it does not create unanswered rows;
- materialize declared printed blanks only in the new service-role-only `flh_paper_exam_submit(..., integer[])` wrapper after declared blank sequence numbers exactly match missing answer rows;
- explicitly revoke `PUBLIC`, `anon`, and `authenticated` execution from the sensitive submit RPCs and grant execution only to `service_role`.

No unrelated Exam behavior is intentionally changed.

## Deployment gate

Do not apply the migration if:

- the live signatures above differ from the expected signatures;
- the preflight ACLs or paper validation functions have drifted unexpectedly;
- the exact PR head has not passed Static quality + Browser smoke;
- CodeRabbit has unresolved actionable findings on that exact head.
