-- Record server-authoritative Exam Mode evidence in the same concept-mastery
-- model used by Learning Mode. Only primary question-concept links contribute,
-- so one submitted question contributes exactly one mastery evidence item.
--
-- Enforce that invariant at the data layer as well: a question may have many
-- secondary concept links, but at most one primary concept link.
create unique index if not exists uq_quiz_question_one_primary_concept
  on public.quiz_question_concepts(workspace_id,question_id)
  where is_primary=true;

-- The helper is idempotent per attempt through attempt metadata and is invoked
-- automatically only on the in_progress -> submitted status transition.
create or replace function public.flh_record_exam_concept_mastery(
  p_workspace_id uuid,
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
  v_evaluated_count integer := 0;
  v_evidence_count integer := 0;
  v_concept_count integer := 0;
  v_old record;
  v_new_score numeric;
  v_assessed_at timestamptz;
  r record;
begin
  select a.id,a.learner_id,a.status,a.delivery_mode,a.submitted_at,a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','ATTEMPT_NOT_FOUND');
  end if;
  if v_attempt.status is distinct from 'submitted' or v_attempt.delivery_mode is distinct from 'exam' then
    return jsonb_build_object('ok',false,'error','NOT_SUBMITTED_EXAM');
  end if;
  if coalesce((v_attempt.metadata->>'concept_mastery_recorded')::boolean,false) is true then
    return jsonb_build_object(
      'ok',true,
      'already_recorded',true,
      'evidence_count',coalesce((v_attempt.metadata->>'concept_mastery_evidence_count')::integer,0),
      'concept_count',coalesce((v_attempt.metadata->>'concept_mastery_concept_count')::integer,0)
    );
  end if;

  select count(*),count(aa.question_id),count(*) filter (where aa.is_correct is not null)
    into v_queue_count,v_answer_count,v_evaluated_count
  from public.quiz_attempt_question_queue qq
  left join public.quiz_attempt_answers aa
    on aa.workspace_id=qq.workspace_id
   and aa.attempt_id=qq.quiz_attempt_id
   and aa.question_id=qq.question_id
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id;

  if v_queue_count < 1 or v_answer_count <> v_queue_count or v_evaluated_count <> v_queue_count then
    return jsonb_build_object('ok',false,'error','EXAM_MASTERY_EVALUATION_INCOMPLETE');
  end if;

  v_assessed_at := coalesce(v_attempt.submitted_at,clock_timestamp());

  for r in
    select qc.concept_id,
           count(*)::integer as evidence_count,
           count(*) filter (where aa.is_correct is true)::integer as correct_count,
           (array_agg(q.difficulty_level order by qq.sequence_no desc))[1]::smallint as last_difficulty
    from public.quiz_attempt_question_queue qq
    join public.quiz_attempt_answers aa
      on aa.workspace_id=qq.workspace_id
     and aa.attempt_id=qq.quiz_attempt_id
     and aa.question_id=qq.question_id
    join public.quiz_questions q
      on q.workspace_id=qq.workspace_id and q.id=qq.question_id
    join public.quiz_question_concepts qc
      on qc.workspace_id=qq.workspace_id
     and qc.question_id=qq.question_id
     and qc.is_primary=true
    where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id
    group by qc.concept_id
  loop
    select m.mastery_score,m.evidence_count,m.first_try_correct_count,
           m.total_question_count,m.total_hint_count,m.metadata
      into v_old
    from public.learner_concept_mastery m
    where m.workspace_id=p_workspace_id
      and m.learner_id=v_attempt.learner_id
      and m.concept_id=r.concept_id
    for update;

    if found then
      v_new_score := round(
        (
          coalesce(v_old.mastery_score,0) * coalesce(v_old.evidence_count,0)
          + r.correct_count * 100.0
        ) / (coalesce(v_old.evidence_count,0) + r.evidence_count),
        2
      );

      update public.learner_concept_mastery
      set mastery_score=v_new_score,
          evidence_count=coalesce(v_old.evidence_count,0)+r.evidence_count,
          first_try_correct_count=coalesce(v_old.first_try_correct_count,0)+r.correct_count,
          total_question_count=coalesce(v_old.total_question_count,0)+r.evidence_count,
          total_hint_count=coalesce(v_old.total_hint_count,0),
          last_difficulty=r.last_difficulty,
          last_assessed_at=v_assessed_at,
          metadata=coalesce(v_old.metadata,'{}'::jsonb) || jsonb_build_object(
            'last_evidence_mode','exam',
            'last_exam_attempt_id',p_attempt_id,
            'last_exam_correct_count',r.correct_count,
            'last_exam_evidence_count',r.evidence_count,
            'mastery_engine','primary-concept-running-evidence-v1'
          )
      where workspace_id=p_workspace_id
        and learner_id=v_attempt.learner_id
        and concept_id=r.concept_id;
    else
      v_new_score := round((r.correct_count * 100.0) / r.evidence_count,2);

      insert into public.learner_concept_mastery(
        workspace_id,learner_id,concept_id,mastery_score,evidence_count,
        first_try_correct_count,total_question_count,total_hint_count,
        last_difficulty,last_assessed_at,metadata
      ) values (
        p_workspace_id,v_attempt.learner_id,r.concept_id,v_new_score,r.evidence_count,
        r.correct_count,r.evidence_count,0,
        r.last_difficulty,v_assessed_at,jsonb_build_object(
          'last_evidence_mode','exam',
          'last_exam_attempt_id',p_attempt_id,
          'last_exam_correct_count',r.correct_count,
          'last_exam_evidence_count',r.evidence_count,
          'mastery_engine','primary-concept-running-evidence-v1'
        )
      );
    end if;

    v_evidence_count := v_evidence_count + r.evidence_count;
    v_concept_count := v_concept_count + 1;
  end loop;

  update public.quiz_attempts
  set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
    'concept_mastery_recorded',true,
    'concept_mastery_recorded_at',clock_timestamp(),
    'concept_mastery_engine','primary-concept-running-evidence-v1',
    'concept_mastery_evidence_count',v_evidence_count,
    'concept_mastery_concept_count',v_concept_count
  )
  where workspace_id=p_workspace_id and id=p_attempt_id;

  return jsonb_build_object(
    'ok',true,
    'already_recorded',false,
    'evidence_count',v_evidence_count,
    'concept_count',v_concept_count
  );
end;
$function$;

revoke all on function public.flh_record_exam_concept_mastery(uuid,uuid) from public;
revoke all on function public.flh_record_exam_concept_mastery(uuid,uuid) from anon, authenticated;
grant execute on function public.flh_record_exam_concept_mastery(uuid,uuid) to service_role;

create or replace function public.flh_record_exam_mastery_on_submit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if new.delivery_mode='exam'
     and new.status='submitted'
     and old.status is distinct from new.status then
    v_result := public.flh_record_exam_concept_mastery(new.workspace_id,new.id);
    if coalesce((v_result->>'ok')::boolean,false) is not true then
      raise exception 'EXAM_MASTERY_RECORD_FAILED:%',coalesce(v_result->>'error','UNKNOWN');
    end if;
  end if;
  return null;
end;
$function$;

revoke all on function public.flh_record_exam_mastery_on_submit() from public;
revoke all on function public.flh_record_exam_mastery_on_submit() from anon, authenticated;
grant execute on function public.flh_record_exam_mastery_on_submit() to service_role;

drop trigger if exists trg_record_exam_mastery_on_submit on public.quiz_attempts;
create trigger trg_record_exam_mastery_on_submit
after update of status on public.quiz_attempts
for each row execute function public.flh_record_exam_mastery_on_submit();

-- One-time historical bridge for approved paper exams that were submitted
-- before the generic Exam mastery hook existed. The helper's attempt marker
-- makes this safe to re-run without double-counting.
do $backfill$
declare
  r record;
  v_result jsonb;
begin
  for r in
    select a.workspace_id,a.id
    from public.quiz_attempts a
    where a.status='submitted'
      and a.delivery_mode='exam'
      and coalesce((a.metadata->>'paper_ingested')::boolean,false) is true
      and coalesce((a.metadata->>'paper_queue_validated')::boolean,false) is true
      and coalesce((a.metadata->>'concept_mastery_recorded')::boolean,false) is not true
  loop
    v_result := public.flh_record_exam_concept_mastery(r.workspace_id,r.id);
    if coalesce((v_result->>'ok')::boolean,false) is not true then
      raise exception 'PAPER_EXAM_MASTERY_BACKFILL_FAILED:%',coalesce(v_result->>'error','UNKNOWN');
    end if;
  end loop;
end;
$backfill$;
