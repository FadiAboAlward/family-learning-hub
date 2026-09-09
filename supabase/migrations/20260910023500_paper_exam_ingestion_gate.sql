-- Dedicated, version-bound paper-exam ingestion path.
-- Paper attempts remain delivery_mode='exam' so normal grading/history/reporting apply,
-- while provenance and queue integrity are enforced server-side.

create or replace function public.flh_paper_exam_runtime_package(
  p_workspace_id uuid,
  p_quiz_version_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  v_paper jsonb;
  v_count integer;
  v_map jsonb;
  v_package jsonb := '[]'::jsonb;
  v_item jsonb;
  v_question_id text;
  v_question_code text;
  v_prompt text;
  v_options jsonb;
  v_correct jsonb;
  i integer;
begin
  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id = p_workspace_id
    and id = p_quiz_version_id;

  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then
    return null;
  end if;

  begin
    v_count := (v_paper->>'paper_question_count')::integer;
  exception when others then
    return null;
  end;

  if v_count is null or v_count < 1 then return null; end if;
  v_map := v_paper->'paper_question_map';
  if v_map is null or jsonb_typeof(v_map) <> 'object' then return null; end if;

  for i in 1..v_count loop
    v_item := v_map->(i::text);
    if v_item is null or jsonb_typeof(v_item) <> 'object' then return null; end if;
    v_question_id := nullif(v_item->>'question_id','');
    if v_question_id is null then return null; end if;

    select q.question_code, q.prompt,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'position', o.position,
               'label', o.label,
               'content', o.content
             ) order by o.position)
             from public.quiz_question_options o
             where o.workspace_id = q.workspace_id
               and o.question_id = q.id
           ), '[]'::jsonb),
           k.correct_answer
      into v_question_code, v_prompt, v_options, v_correct
    from public.quiz_questions q
    join public.quiz_question_answer_keys k
      on k.workspace_id = q.workspace_id
     and k.question_id = q.id
    where q.workspace_id = p_workspace_id
      and q.quiz_version_id = p_quiz_version_id
      and q.id::text = v_question_id
    limit 1;

    if not found then return null; end if;

    v_package := v_package || jsonb_build_array(jsonb_build_object(
      'paper_question_number', i,
      'question_code', v_question_code,
      'prompt', v_prompt,
      'options', v_options,
      'correct_answer', v_correct
    ));
  end loop;

  return v_package;
end;
$function$;

revoke all on function public.flh_paper_exam_runtime_package(uuid,uuid) from public;
revoke all on function public.flh_paper_exam_runtime_package(uuid,uuid) from anon, authenticated;
grant execute on function public.flh_paper_exam_runtime_package(uuid,uuid) to service_role;

create or replace function public.flh_paper_exam_runtime_hash(
  p_workspace_id uuid,
  p_quiz_version_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  v_package jsonb;
begin
  v_package := public.flh_paper_exam_runtime_package(p_workspace_id, p_quiz_version_id);
  if v_package is null then return null; end if;
  return encode(digest(convert_to(v_package::text, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

revoke all on function public.flh_paper_exam_runtime_hash(uuid,uuid) from public;
revoke all on function public.flh_paper_exam_runtime_hash(uuid,uuid) from anon, authenticated;
grant execute on function public.flh_paper_exam_runtime_hash(uuid,uuid) to service_role;

create or replace function public.flh_paper_exam_validate_queue(
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
  v_attempt public.quiz_attempts%rowtype;
  v_paper jsonb;
  v_map jsonb;
  v_item jsonb;
  v_count integer;
  v_queue_count integer;
  v_unique_count integer;
  v_match_count integer;
  v_option_count integer;
  v_mapped_option_count integer;
  v_runtime_hash text;
  v_stored_runtime_hash text;
  v_canonical_package jsonb;
  v_canonical_hash text;
  v_question_id text;
  v_question_code text;
  i integer;
begin
  select * into v_attempt
  from public.quiz_attempts
  where workspace_id = p_workspace_id
    and id = p_attempt_id
    and delivery_mode = 'exam'
  limit 1;

  if not found then return jsonb_build_object('ok',false,'error','PAPER_ATTEMPT_NOT_FOUND'); end if;
  if nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return jsonb_build_object('ok',false,'error','NOT_PAPER_ATTEMPT');
  end if;

  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id = p_workspace_id
    and id = v_attempt.quiz_version_id
    and state = 'published'
  limit 1;

  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then
    return jsonb_build_object('ok',false,'error','PAPER_METADATA_MISSING');
  end if;

  if v_paper->>'paper_model_code' <> v_attempt.metadata->>'paper_model_code' then
    return jsonb_build_object('ok',false,'error','PAPER_MODEL_MISMATCH');
  end if;
  if v_attempt.metadata->>'paper_quiz_version_id' <> v_attempt.quiz_version_id::text then
    return jsonb_build_object('ok',false,'error','PAPER_VERSION_MISMATCH');
  end if;
  if v_paper->>'paper_content_hash' is null or v_paper->>'paper_content_hash' <> v_attempt.metadata->>'paper_content_hash' then
    return jsonb_build_object('ok',false,'error','PAPER_CONTENT_HASH_MISMATCH');
  end if;

  begin
    v_count := (v_paper->>'paper_question_count')::integer;
  exception when others then
    return jsonb_build_object('ok',false,'error','PAPER_QUESTION_COUNT_INVALID');
  end;
  if v_count is null or v_count < 1 then
    return jsonb_build_object('ok',false,'error','PAPER_QUESTION_COUNT_INVALID');
  end if;

  v_map := v_paper->'paper_question_map';
  if v_map is null or jsonb_typeof(v_map) <> 'object' or jsonb_object_length(v_map) <> v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUESTION_MAP_INVALID');
  end if;

  v_runtime_hash := public.flh_paper_exam_runtime_hash(p_workspace_id, v_attempt.quiz_version_id);
  v_stored_runtime_hash := nullif(v_paper->>'paper_runtime_content_hash','');
  if v_runtime_hash is null or v_stored_runtime_hash is null or v_runtime_hash <> v_stored_runtime_hash then
    return jsonb_build_object('ok',false,'error','PAPER_RUNTIME_HASH_MISMATCH');
  end if;
  if v_attempt.metadata->>'paper_runtime_content_hash' <> v_runtime_hash then
    return jsonb_build_object('ok',false,'error','PAPER_ATTEMPT_RUNTIME_HASH_MISMATCH');
  end if;

  v_canonical_package := v_paper->'paper_canonical_package';
  if v_canonical_package is not null then
    v_canonical_hash := encode(digest(convert_to(v_canonical_package::text, 'UTF8'), 'sha256'), 'hex');
    if v_canonical_hash <> v_paper->>'paper_content_hash' then
      return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_HASH_MISMATCH');
    end if;
    if v_canonical_package <> public.flh_paper_exam_runtime_package(p_workspace_id, v_attempt.quiz_version_id) then
      return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_PACKAGE_DRIFT');
    end if;
  elsif coalesce((v_paper->>'paper_legacy_registration')::boolean,false) is not true then
    return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_PACKAGE_MISSING');
  end if;

  select count(*), count(distinct question_id)
    into v_queue_count, v_unique_count
  from public.quiz_attempt_question_queue
  where workspace_id = p_workspace_id
    and quiz_attempt_id = p_attempt_id;

  if v_queue_count <> v_count or v_unique_count <> v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUEUE_COUNT_MISMATCH');
  end if;

  for i in 1..v_count loop
    v_item := v_map->(i::text);
    if v_item is null or jsonb_typeof(v_item) <> 'object' then
      return jsonb_build_object('ok',false,'error','PAPER_QUESTION_MAP_INVALID','question_number',i);
    end if;
    v_question_id := nullif(v_item->>'question_id','');
    v_question_code := nullif(v_item->>'question_code','');
    if v_question_id is null or v_question_code is null then
      return jsonb_build_object('ok',false,'error','PAPER_QUESTION_MAP_INVALID','question_number',i);
    end if;

    select count(*) into v_match_count
    from public.quiz_attempt_question_queue qq
    join public.quiz_questions q
      on q.workspace_id = qq.workspace_id
     and q.id = qq.question_id
    join public.quiz_question_answer_keys k
      on k.workspace_id = q.workspace_id
     and k.question_id = q.id
    where qq.workspace_id = p_workspace_id
      and qq.quiz_attempt_id = p_attempt_id
      and qq.sequence_no = i
      and qq.question_id::text = v_question_id
      and q.quiz_version_id = v_attempt.quiz_version_id
      and q.question_code = v_question_code;

    if v_match_count <> 1 then
      return jsonb_build_object('ok',false,'error','PAPER_QUEUE_MAP_MISMATCH','question_number',i);
    end if;

    if v_item->'option_positions' is null or jsonb_typeof(v_item->'option_positions') <> 'object' then
      return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_INVALID','question_number',i);
    end if;

    begin
      select count(*) into v_mapped_option_count
      from (
        select distinct value::integer as position
        from jsonb_each_text(v_item->'option_positions')
      ) m;
    exception when others then
      return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_INVALID','question_number',i);
    end;

    select count(*) into v_option_count
    from public.quiz_question_options o
    where o.workspace_id = p_workspace_id
      and o.question_id::text = v_question_id;

    if v_mapped_option_count <> jsonb_object_length(v_item->'option_positions') or v_option_count <> v_mapped_option_count then
      return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_COUNT_MISMATCH','question_number',i);
    end if;

    select count(*) into v_match_count
    from jsonb_each_text(v_item->'option_positions') m
    join public.quiz_question_options o
      on o.workspace_id = p_workspace_id
     and o.question_id::text = v_question_id
     and o.position = m.value::integer;
    if v_match_count <> v_mapped_option_count then
      return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_MISMATCH','question_number',i);
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'paper_model_code',v_paper->>'paper_model_code',
    'paper_quiz_version_id',v_attempt.quiz_version_id,
    'paper_question_count',v_count,
    'paper_content_hash',v_paper->>'paper_content_hash',
    'paper_runtime_content_hash',v_runtime_hash
  );
end;
$function$;

revoke all on function public.flh_paper_exam_validate_queue(uuid,uuid) from public;
revoke all on function public.flh_paper_exam_validate_queue(uuid,uuid) from anon, authenticated;
grant execute on function public.flh_paper_exam_validate_queue(uuid,uuid) to service_role;

create or replace function public.flh_paper_exam_start(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_quiz_version_id uuid,
  p_paper_model_code text,
  p_source text default 'uploaded_photos'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_version public.quiz_versions%rowtype;
  v_quiz public.quizzes%rowtype;
  v_attempt public.quiz_attempts%rowtype;
  v_assignment public.quiz_assignments%rowtype;
  v_paper jsonb;
  v_map jsonb;
  v_item jsonb;
  v_count integer;
  v_code_count integer;
  v_question_id text;
  v_question_code text;
  v_difficulty smallint;
  v_runtime_hash text;
  v_stored_runtime_hash text;
  v_validation jsonb;
  v_existing_count integer;
  i integer;
begin
  if nullif(trim(p_paper_model_code),'') is null then
    return jsonb_build_object('error','PAPER_MODEL_CODE_REQUIRED');
  end if;

  if not exists (
    select 1 from public.learners
    where workspace_id = p_workspace_id
      and id = p_learner_id
      and is_active = true
  ) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_learner_id::text || ':' || p_quiz_version_id::text || ':' || p_paper_model_code, 0)
  );

  select v.*, q.id as _quiz_id
    into v_version
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id = v.workspace_id
   and q.id = v.quiz_id
   and q.status = 'active'
  where v.workspace_id = p_workspace_id
    and v.id = p_quiz_version_id
    and v.state = 'published'
  limit 1;
  if not found then return jsonb_build_object('error','PAPER_VERSION_NOT_FOUND'); end if;

  select * into v_quiz
  from public.quizzes
  where workspace_id = p_workspace_id
    and id = v_version.quiz_id
    and status = 'active'
  limit 1;
  if not found then return jsonb_build_object('error','PAPER_QUIZ_NOT_FOUND'); end if;

  v_paper := v_version.settings->'paper_exam';
  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then
    return jsonb_build_object('error','PAPER_METADATA_MISSING');
  end if;
  if v_paper->>'paper_model_code' <> p_paper_model_code then
    return jsonb_build_object('error','PAPER_MODEL_MISMATCH');
  end if;

  select count(*) into v_code_count
  from public.quiz_versions v
  where v.workspace_id = p_workspace_id
    and v.state = 'published'
    and v.settings->'paper_exam'->>'paper_model_code' = p_paper_model_code;
  if v_code_count <> 1 then
    return jsonb_build_object('error','PAPER_MODEL_NOT_UNIQUE','matching_versions',v_code_count);
  end if;

  begin
    v_count := (v_paper->>'paper_question_count')::integer;
  exception when others then
    return jsonb_build_object('error','PAPER_QUESTION_COUNT_INVALID');
  end;
  if v_count is null or v_count < 1 then return jsonb_build_object('error','PAPER_QUESTION_COUNT_INVALID'); end if;

  v_map := v_paper->'paper_question_map';
  if v_map is null or jsonb_typeof(v_map) <> 'object' or jsonb_object_length(v_map) <> v_count then
    return jsonb_build_object('error','PAPER_QUESTION_MAP_INVALID');
  end if;
  if nullif(v_paper->>'paper_content_hash','') is null then
    return jsonb_build_object('error','PAPER_CONTENT_HASH_MISSING');
  end if;

  v_runtime_hash := public.flh_paper_exam_runtime_hash(p_workspace_id, p_quiz_version_id);
  v_stored_runtime_hash := nullif(v_paper->>'paper_runtime_content_hash','');
  if v_runtime_hash is null or v_stored_runtime_hash is null or v_runtime_hash <> v_stored_runtime_hash then
    return jsonb_build_object('error','PAPER_RUNTIME_HASH_MISMATCH');
  end if;

  if v_paper->'paper_canonical_package' is not null then
    if encode(digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),'hex') <> v_paper->>'paper_content_hash' then
      return jsonb_build_object('error','PAPER_CANONICAL_HASH_MISMATCH');
    end if;
    if v_paper->'paper_canonical_package' <> public.flh_paper_exam_runtime_package(p_workspace_id,p_quiz_version_id) then
      return jsonb_build_object('error','PAPER_CANONICAL_PACKAGE_DRIFT');
    end if;
  elsif coalesce((v_paper->>'paper_legacy_registration')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_CANONICAL_PACKAGE_MISSING');
  end if;

  select count(*) into v_existing_count
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.status = 'submitted'
    and a.metadata->>'paper_model_code' = p_paper_model_code;
  if v_existing_count > 0 then
    return jsonb_build_object('error','PAPER_ALREADY_INGESTED');
  end if;

  select * into v_attempt
  from public.quiz_attempts a
  where a.workspace_id = p_workspace_id
    and a.learner_id = p_learner_id
    and a.quiz_version_id = p_quiz_version_id
    and a.status = 'in_progress'
    and a.delivery_mode = 'exam'
    and a.metadata->>'paper_model_code' = p_paper_model_code
  order by a.started_at desc
  limit 1;

  if found then
    v_validation := public.flh_paper_exam_validate_queue(p_workspace_id, v_attempt.id);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      return jsonb_build_object('error','PAPER_EXISTING_ATTEMPT_INVALID','validation',v_validation);
    end if;
    return jsonb_build_object(
      'ok',true,'resumed',true,'attempt_id',v_attempt.id,
      'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
      'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash'
    );
  end if;

  select * into v_assignment
  from public.quiz_assignments qa
  where qa.workspace_id = p_workspace_id
    and qa.learner_id = p_learner_id
    and qa.quiz_version_id = p_quiz_version_id
    and qa.status = 'assigned'
  order by qa.created_at desc
  limit 1;

  if not found then
    insert into public.quiz_assignments(
      workspace_id, learner_id, quiz_version_id, status, available_at, metadata
    ) values (
      p_workspace_id, p_learner_id, p_quiz_version_id, 'assigned', now(),
      jsonb_build_object('source','paper_exam','paper_model_code',p_paper_model_code)
    ) returning * into v_assignment;
  end if;

  insert into public.quiz_attempts(
    workspace_id, learner_id, quiz_version_id, assignment_id,
    status, delivery_mode, metadata
  ) values (
    p_workspace_id, p_learner_id, p_quiz_version_id, v_assignment.id,
    'in_progress', 'exam',
    jsonb_build_object(
      'engine','paper-exam-v1',
      'server_graded',true,
      'server_state',true,
      'paper_model_code',p_paper_model_code,
      'paper_quiz_version_id',p_quiz_version_id::text,
      'paper_content_hash',v_paper->>'paper_content_hash',
      'paper_runtime_content_hash',v_runtime_hash,
      'paper_question_count',v_count,
      'paper_queue_validated',false,
      'paper_ingested',false,
      'paper_source',coalesce(nullif(trim(p_source),''),'uploaded_photos')
    )
  ) returning * into v_attempt;

  for i in 1..v_count loop
    v_item := v_map->(i::text);
    v_question_id := nullif(v_item->>'question_id','');
    v_question_code := nullif(v_item->>'question_code','');
    if v_question_id is null or v_question_code is null then
      raise exception 'PAPER_QUESTION_MAP_INVALID:%', i;
    end if;

    select q.difficulty_level into v_difficulty
    from public.quiz_questions q
    join public.quiz_question_answer_keys k
      on k.workspace_id = q.workspace_id
     and k.question_id = q.id
    where q.workspace_id = p_workspace_id
      and q.quiz_version_id = p_quiz_version_id
      and q.id::text = v_question_id
      and q.question_code = v_question_code
    limit 1;
    if not found then raise exception 'PAPER_QUESTION_NOT_FOUND:%', i; end if;

    insert into public.quiz_attempt_question_queue(
      workspace_id, quiz_attempt_id, sequence_no, question_id,
      source_role, difficulty_level, status, selection_reason
    ) values (
      p_workspace_id, v_attempt.id, i, v_question_id::uuid,
      'core', v_difficulty,
      case when i=1 then 'active' else 'pending' end,
      'paper_exact_mapping'
    );
  end loop;

  v_validation := public.flh_paper_exam_validate_queue(p_workspace_id, v_attempt.id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%', coalesce(v_validation->>'error','UNKNOWN');
  end if;

  update public.quiz_attempts
  set metadata = metadata || jsonb_build_object('paper_queue_validated',true)
  where workspace_id = p_workspace_id and id = v_attempt.id;

  return jsonb_build_object(
    'ok',true,'resumed',false,'attempt_id',v_attempt.id,
    'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
    'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash'
  );
end;
$function$;

revoke all on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) from public;
revoke all on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) from anon, authenticated;
grant execute on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.flh_guard_paper_attempt_answer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt public.quiz_attempts%rowtype;
  v_paper jsonb;
  v_entry record;
  v_matches integer := 0;
  v_option_position integer;
  v_allowed boolean := false;
begin
  select * into v_attempt
  from public.quiz_attempts
  where workspace_id = new.workspace_id
    and id = new.attempt_id
  limit 1;

  if not found or nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return new;
  end if;

  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_NOT_VALIDATED';
  end if;

  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id = new.workspace_id
    and id = v_attempt.quiz_version_id
    and state = 'published'
  limit 1;

  if v_paper is null
     or v_paper->>'paper_model_code' <> v_attempt.metadata->>'paper_model_code'
     or v_paper->>'paper_content_hash' <> v_attempt.metadata->>'paper_content_hash'
     or v_paper->>'paper_runtime_content_hash' <> v_attempt.metadata->>'paper_runtime_content_hash' then
    raise exception 'PAPER_BINDING_MISMATCH';
  end if;

  select key, value into v_entry
  from jsonb_each(v_paper->'paper_question_map')
  where value->>'question_id' = new.question_id::text
  limit 1;
  if not found then raise exception 'PAPER_QUESTION_NOT_MAPPED'; end if;

  select count(*) into v_matches
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id = new.workspace_id
    and qq.quiz_attempt_id = new.attempt_id
    and qq.sequence_no = v_entry.key::integer
    and qq.question_id = new.question_id;
  if v_matches <> 1 then raise exception 'PAPER_QUEUE_MAP_MISMATCH'; end if;

  begin
    v_option_position := nullif(new.response->>'option_position','')::integer;
  exception when others then
    raise exception 'PAPER_ANSWER_INVALID';
  end;
  if v_option_position is null then raise exception 'PAPER_ANSWER_INVALID'; end if;

  select exists(
    select 1
    from jsonb_each_text(v_entry.value->'option_positions') p
    where p.value::integer = v_option_position
  ) into v_allowed;
  if not v_allowed then raise exception 'PAPER_OPTION_NOT_MAPPED'; end if;

  return new;
end;
$function$;

revoke all on function public.flh_guard_paper_attempt_answer() from public;
revoke all on function public.flh_guard_paper_attempt_answer() from anon, authenticated;

drop trigger if exists trg_guard_paper_attempt_answer on public.quiz_attempt_answers;
create trigger trg_guard_paper_attempt_answer
before insert or update on public.quiz_attempt_answers
for each row execute function public.flh_guard_paper_attempt_answer();

create or replace function public.flh_guard_paper_attempt_submit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_validation jsonb;
begin
  if new.status = 'submitted'
     and old.status is distinct from new.status
     and nullif(new.metadata->>'paper_model_code','') is not null then
    v_validation := public.flh_paper_exam_validate_queue(new.workspace_id, new.id);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      raise exception 'PAPER_SUBMIT_VALIDATION_FAILED:%', coalesce(v_validation->>'error','UNKNOWN');
    end if;
    if coalesce((new.metadata->>'paper_queue_validated')::boolean,false) is not true then
      raise exception 'PAPER_QUEUE_NOT_VALIDATED';
    end if;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'paper_ingested',true,
      'paper_ingested_at',clock_timestamp(),
      'paper_queue_validated',true
    );
  end if;
  return new;
end;
$function$;

revoke all on function public.flh_guard_paper_attempt_submit() from public;
revoke all on function public.flh_guard_paper_attempt_submit() from anon, authenticated;

drop trigger if exists trg_guard_paper_attempt_submit on public.quiz_attempts;
create trigger trg_guard_paper_attempt_submit
before update of status on public.quiz_attempts
for each row execute function public.flh_guard_paper_attempt_submit();

create or replace function public.flh_complete_paper_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'submitted'
     and old.status is distinct from new.status
     and new.assignment_id is not null
     and nullif(new.metadata->>'paper_model_code','') is not null then
    update public.quiz_assignments
    set status = 'completed'
    where workspace_id = new.workspace_id
      and id = new.assignment_id
      and learner_id = new.learner_id
      and quiz_version_id = new.quiz_version_id
      and status = 'assigned';
  end if;
  return null;
end;
$function$;

revoke all on function public.flh_complete_paper_assignment() from public;
revoke all on function public.flh_complete_paper_assignment() from anon, authenticated;

drop trigger if exists trg_complete_paper_assignment on public.quiz_attempts;
create trigger trg_complete_paper_assignment
after update of status on public.quiz_attempts
for each row execute function public.flh_complete_paper_assignment();

-- One-time compatibility hardening for the already-approved Aya paper model.
-- Preserve its original paper_content_hash; add an explicit runtime snapshot/hash so
-- the new gate can detect any backend question/option/key drift without rewriting
-- the historical approved hash.
update public.quiz_versions v
set settings = jsonb_set(
  jsonb_set(
    jsonb_set(
      v.settings,
      '{paper_exam,paper_runtime_content_hash}',
      to_jsonb(public.flh_paper_exam_runtime_hash(v.workspace_id,v.id)),
      true
    ),
    '{paper_exam,paper_runtime_package_snapshot}',
    public.flh_paper_exam_runtime_package(v.workspace_id,v.id),
    true
  ),
  '{paper_exam,paper_legacy_registration}',
  'true'::jsonb,
  true
)
where v.settings->'paper_exam'->>'paper_model_code' = 'AYA-AR5-U1-PAPER-20260910-A'
  and nullif(v.settings->'paper_exam'->>'paper_runtime_content_hash','') is null;
