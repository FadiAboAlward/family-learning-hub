-- FLH-FEAT-2026-020 v1.0
-- Forward-only reconciliation: route official support-workbook paper
-- transcriptions through a guarded Exam attempt without changing the existing
-- MCQ paper-exam runtime/hash contract. The support branch is type-aware for
-- single_choice, numeric, short_answer, and ungraded reflection items.

create or replace function public.flh_support_workbook_paper_validate_queue(
  p_workspace_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_version record;
  v_quiz record;
  v_queue_count integer := 0;
  v_unique_count integer := 0;
  v_expected_count integer := 0;
  v_exact_count integer := 0;
  v_runtime_map jsonb := '[]'::jsonb;
  v_runtime_hash text;
begin
  select a.quiz_version_id,a.delivery_mode,a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id
  limit 1;

  if not found
     or v_attempt.delivery_mode<>'exam'
     or coalesce((v_attempt.metadata->>'support_workbook_paper')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_ATTEMPT_NOT_FOUND');
  end if;

  select qv.id,qv.quiz_id,qv.settings,qv.version_no
    into v_version
  from public.quiz_versions qv
  where qv.workspace_id=p_workspace_id
    and qv.id=v_attempt.quiz_version_id
    and qv.state='published'
    and coalesce((qv.settings->>'support_source')::boolean,false) is true
  limit 1;
  if not found then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_VERSION_INVALID');
  end if;

  select q.id,q.slug,q.delivery_config
    into v_quiz
  from public.quizzes q
  where q.workspace_id=p_workspace_id
    and q.id=v_version.quiz_id
    and q.status='active'
    and coalesce((q.delivery_config->>'support_session')::boolean,false) is true
  limit 1;
  if not found then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_SESSION_INVALID');
  end if;

  if nullif(v_attempt.metadata->>'support_source_code','') is null
     or v_attempt.metadata->>'support_source_code' is distinct from v_version.settings->>'source_code'
     or v_attempt.metadata->>'support_session_slug' is distinct from v_quiz.slug
     or v_attempt.metadata->>'paper_quiz_version_id' is distinct from v_attempt.quiz_version_id::text
     or v_attempt.metadata->'support_source_pdf_pages' is distinct from coalesce(v_version.settings->'source_pdf_pages','[]'::jsonb) then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_IDENTITY_MISMATCH');
  end if;

  select count(*)
    into v_expected_count
  from public.quiz_questions q
  where q.workspace_id=p_workspace_id
    and q.quiz_version_id=v_attempt.quiz_version_id
    and q.delivery_role='core';

  select count(*),count(distinct qq.question_id)
    into v_queue_count,v_unique_count
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id
    and qq.quiz_attempt_id=p_attempt_id;

  if v_expected_count<1
     or v_queue_count<>v_expected_count
     or v_unique_count<>v_expected_count then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_QUEUE_COUNT_MISMATCH');
  end if;

  with expected as (
    select q.id,q.question_code,q.question_type,q.position,q.source_page_start,
           coalesce(q.source_metadata->>'grading_mode','graded') as grading_mode,
           row_number() over(order by q.position,q.id)::integer as sequence_no
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=v_attempt.quiz_version_id
      and q.delivery_role='core'
  )
  select count(*)
    into v_exact_count
  from expected e
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=p_workspace_id
   and qq.quiz_attempt_id=p_attempt_id
   and qq.sequence_no=e.sequence_no
   and qq.question_id=e.id;

  if v_exact_count<>v_expected_count then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_QUEUE_MAP_MISMATCH');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'sequence_no',x.sequence_no,
      'question_id',x.id,
      'question_code',x.question_code,
      'question_type',x.question_type,
      'grading_mode',x.grading_mode,
      'source_page',x.source_page_start
    ) order by x.sequence_no
  ),'[]'::jsonb)
  into v_runtime_map
  from (
    select q.id,q.question_code,q.question_type,q.source_page_start,
           coalesce(q.source_metadata->>'grading_mode','graded') as grading_mode,
           row_number() over(order by q.position,q.id)::integer as sequence_no
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=v_attempt.quiz_version_id
      and q.delivery_role='core'
  ) x;

  v_runtime_hash:=encode(
    extensions.digest(convert_to(v_runtime_map::text,'UTF8'),'sha256'),
    'hex'
  );

  if nullif(v_attempt.metadata->>'support_question_map_hash','') is null
     or v_attempt.metadata->>'support_question_map_hash' is distinct from v_runtime_hash then
    return jsonb_build_object('ok',false,'error','SUPPORT_PAPER_RUNTIME_HASH_MISMATCH');
  end if;

  return jsonb_build_object(
    'ok',true,
    'support_source_code',v_version.settings->>'source_code',
    'support_session_slug',v_quiz.slug,
    'quiz_version_id',v_attempt.quiz_version_id,
    'question_count',v_expected_count,
    'question_map_hash',v_runtime_hash
  );
end;
$function$;

revoke all on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) from public;
revoke all on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) to service_role;


-- Preserve all legacy paper-exam behavior, but route support-workbook paper
-- attempts through the type-aware support validator before accepting answers.
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
  v_question record;
  v_value text;
begin
  select quiz_version_id,metadata into v_attempt
  from public.quiz_attempts
  where workspace_id=new.workspace_id and id=new.attempt_id
  limit 1;

  if not found or nullif(v_attempt.metadata->>'paper_model_code','') is null then
    if new.response ? 'unanswered' then
      raise exception 'UNANSWERED_REQUIRES_PAPER_ATTEMPT';
    end if;
    return new;
  end if;

  if coalesce((v_attempt.metadata->>'support_workbook_paper')::boolean,false) is true then
    if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
      raise exception 'PAPER_QUEUE_NOT_VALIDATED';
    end if;

    v_validation:=public.flh_support_workbook_paper_validate_queue(new.workspace_id,new.attempt_id);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
    end if;

    select q.question_type,
           coalesce(q.source_metadata->>'grading_mode','graded') as grading_mode
      into v_question
    from public.quiz_questions q
    join public.quiz_attempt_question_queue qq
      on qq.workspace_id=q.workspace_id
     and qq.question_id=q.id
     and qq.quiz_attempt_id=new.attempt_id
    where q.workspace_id=new.workspace_id
      and q.id=new.question_id
      and q.quiz_version_id=v_attempt.quiz_version_id
    limit 1;

    if not found then
      raise exception 'PAPER_QUESTION_NOT_MAPPED';
    end if;

    if new.response='{"unanswered":true}'::jsonb then
      if (tg_op='INSERT' or old.response is distinct from new.response)
         and current_setting('flh.support_paper_attempt_id',true) is distinct from new.attempt_id::text then
        raise exception 'PAPER_UNANSWERED_REQUIRES_DECLARED_SUBMIT';
      end if;
      if new.attempts_used is distinct from 0 or new.hints_used is distinct from 0 then
        raise exception 'PAPER_UNANSWERED_INTERACTION_INVALID';
      end if;
      return new;
    end if;

    if new.response ? 'unanswered'
       or jsonb_typeof(new.response)<>'object'
       or jsonb_object_length(new.response)<>1 then
      raise exception 'PAPER_ANSWER_INVALID';
    end if;

    if v_question.grading_mode='ungraded' then
      if jsonb_typeof(new.response->'value')<>'string'
         or nullif(btrim(new.response->>'value'),'') is null
         or char_length(new.response->>'value')>2000 then
        raise exception 'PAPER_ANSWER_INVALID';
      end if;
      return new;
    end if;

    if v_question.question_type='single_choice' then
      begin
        v_option_position:=nullif(new.response->>'option_position','')::integer;
      exception when others then
        raise exception 'PAPER_ANSWER_INVALID';
      end;
      if v_option_position is null or not exists (
        select 1
        from public.quiz_question_options o
        where o.workspace_id=new.workspace_id
          and o.question_id=new.question_id
          and o.position=v_option_position
      ) then
        raise exception 'PAPER_OPTION_NOT_MAPPED';
      end if;
      return new;
    end if;

    if v_question.question_type in ('numeric','short_answer') then
      if jsonb_typeof(new.response->'value')<>'string'
         or nullif(btrim(new.response->>'value'),'') is null
         or char_length(new.response->>'value')>2000 then
        raise exception 'PAPER_ANSWER_INVALID';
      end if;
      if v_question.question_type='numeric' then
        begin
          v_value:=replace(btrim(new.response->>'value'),',','.');
          perform v_value::numeric;
        exception when others then
          raise exception 'PAPER_ANSWER_INVALID';
        end;
      end if;
      return new;
    end if;

    raise exception 'PAPER_QUESTION_TYPE_UNSUPPORTED';
  end if;

  -- Legacy MCQ paper-exam guard remains behavior-identical below.
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

  if new.response='{"unanswered":true}'::jsonb then
    if (tg_op='INSERT' or old.response is distinct from new.response)
       and current_setting('flh.paper_unanswered_attempt_id',true) is distinct from new.attempt_id::text then
      raise exception 'PAPER_UNANSWERED_REQUIRES_DECLARED_SUBMIT';
    end if;
    if new.attempts_used is distinct from 0 or new.hints_used is distinct from 0 then
      raise exception 'PAPER_UNANSWERED_INTERACTION_INVALID';
    end if;
    return new;
  end if;

  if new.response ? 'unanswered' then
    raise exception 'PAPER_ANSWER_INVALID';
  end if;

  begin
    v_option_position:=nullif(new.response->>'option_position','')::integer;
  exception when others then
    raise exception 'PAPER_ANSWER_INVALID';
  end;

  if v_option_position is null or not exists (
    select 1
    from jsonb_each_text(v_entry->'option_positions') p
    where p.value~'^[1-9][0-9]*$'
      and p.value::integer=v_option_position
  ) then
    raise exception 'PAPER_OPTION_NOT_MAPPED';
  end if;

  return new;
end;
$function$;

revoke all on function public.flh_guard_paper_attempt_answer() from public;
revoke all on function public.flh_guard_paper_attempt_answer() from anon,authenticated;


-- Exam mastery remains unchanged for ordinary exams. For support paper attempts,
-- ungraded reflections are complete answer rows but are intentionally excluded
-- from correctness/mastery evidence.
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
  v_queue_count integer:=0;
  v_answer_count integer:=0;
  v_graded_count integer:=0;
  v_evaluated_count integer:=0;
  v_evidence_count integer:=0;
  v_concept_count integer:=0;
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

  if not found then return jsonb_build_object('ok',false,'error','ATTEMPT_NOT_FOUND'); end if;
  if v_attempt.status is distinct from 'submitted' or v_attempt.delivery_mode is distinct from 'exam' then
    return jsonb_build_object('ok',false,'error','NOT_SUBMITTED_EXAM');
  end if;
  if coalesce((v_attempt.metadata->>'concept_mastery_recorded')::boolean,false) is true then
    return jsonb_build_object(
      'ok',true,'already_recorded',true,
      'evidence_count',coalesce((v_attempt.metadata->>'concept_mastery_evidence_count')::integer,0),
      'concept_count',coalesce((v_attempt.metadata->>'concept_mastery_concept_count')::integer,0)
    );
  end if;

  select count(*),
         count(aa.question_id),
         count(*) filter (where coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded'),
         count(*) filter (
           where coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded'
             and aa.is_correct is not null
         )
    into v_queue_count,v_answer_count,v_graded_count,v_evaluated_count
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q
    on q.workspace_id=qq.workspace_id and q.id=qq.question_id
  left join public.quiz_attempt_answers aa
    on aa.workspace_id=qq.workspace_id
   and aa.attempt_id=qq.quiz_attempt_id
   and aa.question_id=qq.question_id
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id;

  if v_queue_count<1
     or v_answer_count<>v_queue_count
     or v_evaluated_count<>v_graded_count then
    return jsonb_build_object('ok',false,'error','EXAM_MASTERY_EVALUATION_INCOMPLETE');
  end if;

  v_assessed_at:=coalesce(v_attempt.submitted_at,clock_timestamp());

  for r in
    select qc.concept_id,
           count(*)::integer as evidence_count,
           count(*) filter (where aa.is_correct is true)::integer as correct_count,
           count(*) filter (where aa.first_try_correct is true)::integer as first_try_count,
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
    where qq.workspace_id=p_workspace_id
      and qq.quiz_attempt_id=p_attempt_id
      and coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded'
      and aa.is_correct is not null
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
      v_new_score:=round(
        (coalesce(v_old.mastery_score,0)*coalesce(v_old.evidence_count,0)+r.correct_count*100.0)
        /(coalesce(v_old.evidence_count,0)+r.evidence_count),2
      );
      update public.learner_concept_mastery
      set mastery_score=v_new_score,
          evidence_count=coalesce(v_old.evidence_count,0)+r.evidence_count,
          first_try_correct_count=coalesce(v_old.first_try_correct_count,0)+r.first_try_count,
          total_question_count=coalesce(v_old.total_question_count,0)+r.evidence_count,
          total_hint_count=coalesce(v_old.total_hint_count,0),
          last_difficulty=r.last_difficulty,
          last_assessed_at=v_assessed_at,
          metadata=coalesce(v_old.metadata,'{}'::jsonb)||jsonb_build_object(
            'last_evidence_mode','exam',
            'last_exam_attempt_id',p_attempt_id,
            'last_exam_correct_count',r.correct_count,
            'last_exam_first_try_count',r.first_try_count,
            'last_exam_evidence_count',r.evidence_count,
            'mastery_engine','primary-concept-running-evidence-v1'
          )
      where workspace_id=p_workspace_id
        and learner_id=v_attempt.learner_id
        and concept_id=r.concept_id;
    else
      v_new_score:=round((r.correct_count*100.0)/r.evidence_count,2);
      insert into public.learner_concept_mastery(
        workspace_id,learner_id,concept_id,mastery_score,evidence_count,
        first_try_correct_count,total_question_count,total_hint_count,
        last_difficulty,last_assessed_at,metadata
      ) values (
        p_workspace_id,v_attempt.learner_id,r.concept_id,v_new_score,r.evidence_count,
        r.first_try_count,r.evidence_count,0,r.last_difficulty,v_assessed_at,
        jsonb_build_object(
          'last_evidence_mode','exam',
          'last_exam_attempt_id',p_attempt_id,
          'last_exam_correct_count',r.correct_count,
          'last_exam_first_try_count',r.first_try_count,
          'last_exam_evidence_count',r.evidence_count,
          'mastery_engine','primary-concept-running-evidence-v1'
        )
      );
    end if;

    v_evidence_count:=v_evidence_count+r.evidence_count;
    v_concept_count:=v_concept_count+1;
  end loop;

  update public.quiz_attempts
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'concept_mastery_recorded',true,
    'concept_mastery_recorded_at',clock_timestamp(),
    'concept_mastery_engine','primary-concept-running-evidence-v1',
    'concept_mastery_evidence_count',v_evidence_count,
    'concept_mastery_concept_count',v_concept_count
  )
  where workspace_id=p_workspace_id and id=p_attempt_id;

  return jsonb_build_object(
    'ok',true,'already_recorded',false,
    'evidence_count',v_evidence_count,'concept_count',v_concept_count
  );
end;
$function$;

revoke all on function public.flh_record_exam_concept_mastery(uuid,uuid) from public;
revoke all on function public.flh_record_exam_concept_mastery(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_record_exam_concept_mastery(uuid,uuid) to service_role;


create or replace function public.flh_support_workbook_paper_ingest(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_version_id uuid,
  p_session_slug text,
  p_request_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_version public.quiz_versions%rowtype;
  v_quiz public.quizzes%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_question public.quiz_questions%rowtype;
  v_key public.quiz_question_answer_keys%rowtype;
  v_response jsonb;
  v_input_response jsonb;
  v_grading text;
  v_is_correct boolean;
  v_points numeric;
  v_score numeric:=0;
  v_max numeric:=0;
  v_percentage numeric:=0;
  v_question_count integer:=0;
  v_graded_count integer:=0;
  v_ungraded_count integer:=0;
  v_unanswered_count integer:=0;
  v_option_position integer;
  v_numeric_response numeric;
  v_numeric_correct numeric;
  v_tolerance numeric;
  v_text_response text;
  v_concept_id uuid;
  v_existing_result jsonb;
  v_result jsonb;
  v_runtime_map jsonb:='[]'::jsonb;
  v_runtime_hash text;
  v_request_hash text;
  v_model_code text;
  v_validation jsonb;
  v_sequence integer:=0;
begin
  if p_workspace_id is null
     or p_learner_id is null
     or p_quiz_version_id is null
     or nullif(btrim(p_session_slug),'') is null
     or p_request_id is null
     or p_responses is null
     or jsonb_typeof(p_responses)<>'object' then
    return jsonb_build_object('error','INVALID_PAPER_INGESTION');
  end if;

  if not exists (
    select 1 from public.learners l
    where l.workspace_id=p_workspace_id
      and l.id=p_learner_id
      and l.is_active
  ) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text||':'||p_learner_id::text||':'||
    p_quiz_version_id::text||':support-paper',
    0
  ));

  select qv.* into v_version
  from public.quiz_versions qv
  where qv.workspace_id=p_workspace_id
    and qv.id=p_quiz_version_id
    and qv.state='published'
  limit 1;

  if not found
     or coalesce((v_version.settings->>'support_source')::boolean,false) is not true
     or nullif(v_version.settings->>'source_code','') is null then
    return jsonb_build_object('error','SUPPORT_VERSION_NOT_FOUND');
  end if;

  select q.* into v_quiz
  from public.quizzes q
  where q.workspace_id=p_workspace_id
    and q.id=v_version.quiz_id
    and q.status='active'
    and q.slug=p_session_slug
    and coalesce((q.delivery_config->>'support_session')::boolean,false) is true
  limit 1;

  if not found then return jsonb_build_object('error','SUPPORT_SESSION_MISMATCH'); end if;

  if not (
    exists (
      select 1
      from public.learner_program_enrollments e
      join public.learning_programs lp
        on lp.workspace_id=e.workspace_id
       and lp.id=e.program_id
       and lp.status='active'
      join public.program_quizzes pq
        on pq.workspace_id=e.workspace_id
       and pq.program_id=e.program_id
       and pq.quiz_id=v_quiz.id
       and pq.availability='available'
      where e.workspace_id=p_workspace_id
        and e.learner_id=p_learner_id
        and e.status='active'
    )
    or exists (
      select 1
      from public.quiz_assignments qa
      where qa.workspace_id=p_workspace_id
        and qa.learner_id=p_learner_id
        and qa.quiz_version_id=p_quiz_version_id
        and qa.status in ('assigned','in_progress')
        and (qa.available_at is null or qa.available_at<=now())
        and (qa.due_at is null or qa.due_at>=now())
    )
  ) then
    return jsonb_build_object('error','QUIZ_NOT_AVAILABLE');
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_responses) response_key(question_code)
    where not exists (
      select 1
      from public.quiz_questions q
      where q.workspace_id=p_workspace_id
        and q.quiz_version_id=p_quiz_version_id
        and q.delivery_role='core'
        and q.question_code=response_key.question_code
    )
  ) or exists (
    select 1
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
      and not (p_responses ? q.question_code)
  ) then
    return jsonb_build_object('error','PAPER_RESPONSE_MAP_INVALID');
  end if;

  -- Validate every transcription shape before any attempt/evidence row exists.
  for v_question in
    select q.*
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
    order by q.position,q.id
  loop
    v_input_response:=p_responses->v_question.question_code;
    v_grading:=coalesce(v_question.source_metadata->>'grading_mode','graded');

    if v_input_response='{"support_unanswered":true}'::jsonb then
      continue;
    end if;

    if jsonb_typeof(v_input_response)<>'object'
       or jsonb_object_length(v_input_response)<>1 then
      return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
    end if;

    if v_grading='ungraded' then
      if jsonb_typeof(v_input_response->'value')<>'string'
         or nullif(btrim(v_input_response->>'value'),'') is null
         or char_length(v_input_response->>'value')>2000 then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
      continue;
    end if;

    if v_question.question_type='single_choice' then
      begin
        v_option_position:=(v_input_response->>'option_position')::integer;
      exception when others then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end;
      if not exists (
        select 1 from public.quiz_question_options o
        where o.workspace_id=p_workspace_id
          and o.question_id=v_question.id
          and o.position=v_option_position
      ) then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
    elsif v_question.question_type in ('numeric','short_answer') then
      if jsonb_typeof(v_input_response->'value')<>'string'
         or nullif(btrim(v_input_response->>'value'),'') is null
         or char_length(v_input_response->>'value')>2000 then
        return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
      end if;
      if v_question.question_type='numeric' then
        begin
          perform replace(btrim(v_input_response->>'value'),',','.')::numeric;
        exception when others then
          return jsonb_build_object('error','PAPER_RESPONSE_INVALID','question_code',v_question.question_code);
        end;
      end if;
    else
      return jsonb_build_object('error','PAPER_QUESTION_TYPE_UNSUPPORTED','question_code',v_question.question_code);
    end if;
  end loop;

  v_request_hash:=encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'quiz_version_id',p_quiz_version_id,
        'session_slug',p_session_slug,
        'responses',p_responses
      )::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select a.* into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id
    and a.learner_id=p_learner_id
    and a.metadata->>'support_paper_request_id'=p_request_id::text
  order by a.started_at desc
  limit 1;

  if found then
    if v_attempt.quiz_version_id<>p_quiz_version_id
       or v_attempt.metadata->>'support_session_slug' is distinct from p_session_slug
       or v_attempt.metadata->>'support_paper_request_hash' is distinct from v_request_hash then
      return jsonb_build_object('error','PAPER_REQUEST_CONFLICT');
    end if;
    if v_attempt.status='submitted' then
      v_existing_result:=v_attempt.metadata->'support_paper_result';
      if jsonb_typeof(v_existing_result)='object' then return v_existing_result; end if;
      return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
    end if;
    return jsonb_build_object('error','SESSION_IN_PROGRESS');
  end if;

  -- A digital or paper completion of this immutable session is one evidence event.
  if exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='submitted'
  ) then
    return jsonb_build_object('error','SESSION_ALREADY_COMPLETED');
  end if;

  if exists (
    select 1 from public.quiz_attempts a
    where a.workspace_id=p_workspace_id
      and a.learner_id=p_learner_id
      and a.quiz_version_id=p_quiz_version_id
      and a.status='in_progress'
  ) then
    return jsonb_build_object('error','SESSION_IN_PROGRESS');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'sequence_no',x.sequence_no,
      'question_id',x.id,
      'question_code',x.question_code,
      'question_type',x.question_type,
      'grading_mode',x.grading_mode,
      'source_page',x.source_page_start
    ) order by x.sequence_no
  ),'[]'::jsonb)
  into v_runtime_map
  from (
    select q.id,q.question_code,q.question_type,q.source_page_start,
           coalesce(q.source_metadata->>'grading_mode','graded') as grading_mode,
           row_number() over(order by q.position,q.id)::integer as sequence_no
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
  ) x;

  v_runtime_hash:=encode(
    extensions.digest(convert_to(v_runtime_map::text,'UTF8'),'sha256'),
    'hex'
  );
  v_model_code:='SUPPORT:'||v_version.settings->>'source_code'||':'||p_session_slug||':v'||v_version.version_no::text;

  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,status,delivery_mode,metadata
  ) values (
    p_workspace_id,p_learner_id,p_quiz_version_id,'in_progress','exam',
    jsonb_build_object(
      'engine','support-paper-exam-v1',
      'server_graded',true,
      'server_state',true,
      'delivery_surface','paper',
      'support_workbook_paper',true,
      'support_source_code',v_version.settings->>'source_code',
      'support_session_slug',p_session_slug,
      'support_source_pdf_pages',coalesce(v_version.settings->'source_pdf_pages','[]'::jsonb),
      'support_paper_request_id',p_request_id::text,
      'support_paper_request_hash',v_request_hash,
      'support_question_map_hash',v_runtime_hash,
      'paper_model_code',v_model_code,
      'paper_quiz_version_id',p_quiz_version_id::text,
      'paper_queue_validated',false,
      'paper_ingested',false
    )
  ) returning * into v_attempt;

  insert into public.quiz_attempt_question_queue(
    workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,
    concept_id,difficulty_level,status,selection_reason
  )
  select
    p_workspace_id,
    v_attempt.id,
    row_number() over(order by q.position,q.id)::integer,
    q.id,
    'core',
    qc.concept_id,
    q.difficulty_level,
    'pending',
    'support_paper_exact_mapping'
  from public.quiz_questions q
  left join public.quiz_question_concepts qc
    on qc.workspace_id=q.workspace_id
   and qc.question_id=q.id
   and qc.is_primary
  where q.workspace_id=p_workspace_id
    and q.quiz_version_id=p_quiz_version_id
    and q.delivery_role='core'
  order by q.position,q.id;

  v_validation:=public.flh_support_workbook_paper_validate_queue(p_workspace_id,v_attempt.id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'SUPPORT_PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;

  update public.quiz_attempts
  set metadata=metadata||jsonb_build_object('paper_queue_validated',true)
  where workspace_id=p_workspace_id and id=v_attempt.id;

  perform set_config('flh.support_paper_attempt_id',v_attempt.id::text,true);

  v_sequence:=0;
  for v_question in
    select q.*
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.delivery_role='core'
    order by q.position,q.id
  loop
    v_sequence:=v_sequence+1;
    v_question_count:=v_question_count+1;
    v_grading:=coalesce(v_question.source_metadata->>'grading_mode','graded');
    v_input_response:=p_responses->v_question.question_code;
    v_response:=case
      when v_input_response='{"support_unanswered":true}'::jsonb
        then '{"unanswered":true}'::jsonb
      else v_input_response
    end;

    select qc.concept_id into v_concept_id
    from public.quiz_question_concepts qc
    where qc.workspace_id=p_workspace_id
      and qc.question_id=v_question.id
      and qc.is_primary
    limit 1;

    if v_response='{"unanswered":true}'::jsonb then
      v_unanswered_count:=v_unanswered_count+1;
      if v_grading='ungraded' then
        v_ungraded_count:=v_ungraded_count+1;
        insert into public.quiz_attempt_answers(
          workspace_id,attempt_id,question_id,response,evaluation,is_correct,
          points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
        ) values (
          p_workspace_id,v_attempt.id,v_question.id,v_response,'ungraded',null,
          0,0,0,null,null
        );
      else
        v_graded_count:=v_graded_count+1;
        v_max:=v_max+coalesce(v_question.points,0);
        insert into public.quiz_attempt_answers(
          workspace_id,attempt_id,question_id,response,evaluation,is_correct,
          points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
        ) values (
          p_workspace_id,v_attempt.id,v_question.id,v_response,'incorrect',false,
          0,0,0,false,'not_mastered'
        );
      end if;
      continue;
    end if;

    if v_grading='ungraded' then
      v_ungraded_count:=v_ungraded_count+1;
      insert into public.quiz_attempt_answers(
        workspace_id,attempt_id,question_id,response,evaluation,is_correct,
        points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
      ) values (
        p_workspace_id,v_attempt.id,v_question.id,v_response,'ungraded',null,
        0,1,0,null,null
      );
      continue;
    end if;

    v_graded_count:=v_graded_count+1;
    v_max:=v_max+coalesce(v_question.points,0);
    v_is_correct:=false;
    v_points:=0;

    select k.* into v_key
    from public.quiz_question_answer_keys k
    where k.workspace_id=p_workspace_id
      and k.question_id=v_question.id;

    if not found then
      raise exception 'SUPPORT_PAPER_ANSWER_KEY_MISSING:%',v_question.question_code;
    end if;

    if v_question.question_type='single_choice' then
      v_option_position:=(v_response->>'option_position')::integer;
      v_is_correct:=v_option_position=(v_key.correct_answer->>'option_position')::integer;
    elsif v_question.question_type='numeric' then
      v_numeric_response:=replace(btrim(v_response->>'value'),',','.')::numeric;
      v_numeric_correct:=replace(btrim(v_key.correct_answer->>'value'),',','.')::numeric;
      v_tolerance:=coalesce(
        nullif(v_key.grading_config->>'absolute_tolerance','')::numeric,
        nullif(v_key.correct_answer->>'tolerance','')::numeric,
        0
      );
      v_is_correct:=abs(v_numeric_response-v_numeric_correct)<=greatest(v_tolerance,0);
    elsif v_question.question_type='short_answer' then
      v_text_response:=lower(regexp_replace(btrim(coalesce(v_response->>'value','')),'[[:space:]]+','','g'));
      if jsonb_typeof(v_key.correct_answer->'accepted_text')='array' then
        select exists(
          select 1
          from jsonb_array_elements_text(v_key.correct_answer->'accepted_text') t(value)
          where lower(regexp_replace(btrim(t.value),'[[:space:]]+','','g'))=v_text_response
        ) into v_is_correct;
      else
        v_is_correct:=v_text_response=
          lower(regexp_replace(btrim(coalesce(v_key.correct_answer->>'value','')),'[[:space:]]+','','g'));
      end if;
    else
      raise exception 'SUPPORT_PAPER_QUESTION_TYPE_UNSUPPORTED:%',v_question.question_code;
    end if;

    if v_is_correct then
      v_points:=coalesce(v_question.points,0);
      v_score:=v_score+v_points;
    end if;

    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,
      points_awarded,attempts_used,hints_used,first_try_correct,mastery_result
    ) values (
      p_workspace_id,v_attempt.id,v_question.id,v_response,
      case when v_is_correct then 'correct' else 'incorrect' end,
      v_is_correct,v_points,1,0,v_is_correct,
      case when v_is_correct then 'mastered' else 'not_mastered' end
    );
  end loop;

  perform set_config('flh.support_paper_attempt_id','',true);

  if v_question_count=0 then raise exception 'SUPPORT_PAPER_EMPTY_SESSION'; end if;

  v_percentage:=case when v_max>0 then round(v_score/v_max*100,2) else 0 end;
  v_result:=jsonb_build_object(
    'ok',true,
    'attempt_id',v_attempt.id,
    'quiz_version_id',p_quiz_version_id,
    'session_slug',p_session_slug,
    'score_points',v_score,
    'max_points',v_max,
    'percentage',v_percentage,
    'question_count',v_question_count,
    'graded_count',v_graded_count,
    'ungraded_count',v_ungraded_count,
    'unanswered_count',v_unanswered_count,
    'paper_ingested',true,
    'delivery_mode','exam'
  );

  update public.quiz_attempts
  set status='submitted',
      submitted_at=clock_timestamp(),
      score_points=v_score,
      max_points=v_max,
      percentage=v_percentage,
      duration_seconds=greatest(1,round(extract(epoch from (clock_timestamp()-started_at)))::integer),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'paper_ingested',true,
        'paper_ingested_at',clock_timestamp(),
        'support_paper_result',v_result
      )
  where workspace_id=p_workspace_id
    and id=v_attempt.id
    and learner_id=p_learner_id
    and status='in_progress';

  update public.quiz_attempt_question_queue
  set status='completed'
  where workspace_id=p_workspace_id
    and quiz_attempt_id=v_attempt.id;

  return v_result;
end;
$function$;

revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from public;
revoke all on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) from anon,authenticated;
grant execute on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

comment on function public.flh_support_workbook_paper_ingest(uuid,uuid,uuid,text,uuid,jsonb) is
  'Ingests one exact official support-workbook session through a guarded Exam-mode paper attempt. Objective items are server graded, ungraded reflections are stored without correctness/mastery evidence, and digital/paper duplicate evidence is blocked.';
