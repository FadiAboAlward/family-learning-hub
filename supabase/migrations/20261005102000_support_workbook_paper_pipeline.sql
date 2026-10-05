-- FLH-FEAT-2026-020 v1.0
-- Forward-only extension of the canonical paper-exam pipeline for official
-- support-workbook sessions. Legacy paper behavior is preserved via aliases.
-- Support sessions reuse the same immutable model/hash/map/start/submit gates,
-- while allowing numeric, short-answer, and explicitly ungraded reflections.



create or replace function public.flh_paper_exam_runtime_package_legacy_flh020(
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
  v_map jsonb;
  v_count integer;
  v_item jsonb;
  v_question_id text;
  v_question_code text;
  v_prompt text;
  v_options jsonb;
  v_correct jsonb;
  v_package jsonb := '[]'::jsonb;
  i integer;
begin
  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id = p_workspace_id
    and id = p_quiz_version_id
    and state = 'published';

  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then return null; end if;
  begin
    v_count := (v_paper->>'paper_question_count')::integer;
  exception when others then
    return null;
  end;
  if v_count is null or v_count < 1 then return null; end if;

  v_map := v_paper->'paper_question_map';
  if v_map is null or jsonb_typeof(v_map) <> 'object' or jsonb_object_length(v_map) <> v_count then
    return null;
  end if;

  for i in 1..v_count loop
    v_item := v_map->(i::text);
    if v_item is null or jsonb_typeof(v_item) <> 'object' then return null; end if;
    v_question_id := nullif(v_item->>'question_id','');
    if v_question_id is null then return null; end if;

    select q.question_code,
           q.prompt,
           coalesce((
             select jsonb_agg(
               jsonb_build_object('position',o.position,'label',o.label,'content',o.content)
               order by o.position
             )
             from public.quiz_question_options o
             where o.workspace_id=q.workspace_id and o.question_id=q.id
           ),'[]'::jsonb),
           k.correct_answer
      into v_question_code, v_prompt, v_options, v_correct
    from public.quiz_questions q
    join public.quiz_question_answer_keys k
      on k.workspace_id=q.workspace_id and k.question_id=q.id
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.id::text=v_question_id
    limit 1;

    if not found then return null; end if;

    v_package := v_package || jsonb_build_array(jsonb_build_object(
      'paper_question_number',i,
      'question_code',v_question_code,
      'prompt',v_prompt,
      'options',v_options,
      'correct_answer',v_correct
    ));
  end loop;

  return v_package;
end;
$function$;

create or replace function public.flh_paper_exam_validate_queue_legacy_flh020(
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
  v_paper jsonb;
  v_map jsonb;
  v_count integer;
  v_queue_count integer;
  v_unique_count integer;
  v_exact_count integer;
  v_bad_option_maps integer;
  v_runtime_package jsonb;
  v_runtime_hash text;
  v_stored_runtime_hash text;
  v_canonical_hash text;
begin
  select a.quiz_version_id,a.delivery_mode,a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id
  limit 1;

  if not found or v_attempt.delivery_mode <> 'exam' then
    return jsonb_build_object('ok',false,'error','PAPER_ATTEMPT_NOT_FOUND');
  end if;
  if nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return jsonb_build_object('ok',false,'error','NOT_PAPER_ATTEMPT');
  end if;

  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id=p_workspace_id
    and id=v_attempt.quiz_version_id
    and state='published';
  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then
    return jsonb_build_object('ok',false,'error','PAPER_METADATA_MISSING');
  end if;

  if nullif(v_paper->>'paper_model_code','') is null
     or v_paper->>'paper_model_code' is distinct from v_attempt.metadata->>'paper_model_code' then
    return jsonb_build_object('ok',false,'error','PAPER_MODEL_MISMATCH');
  end if;
  if v_attempt.metadata->>'paper_quiz_version_id' is distinct from v_attempt.quiz_version_id::text then
    return jsonb_build_object('ok',false,'error','PAPER_VERSION_MISMATCH');
  end if;
  if nullif(v_paper->>'paper_content_hash','') is null
     or v_paper->>'paper_content_hash' is distinct from v_attempt.metadata->>'paper_content_hash' then
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

  v_runtime_package := public.flh_paper_exam_runtime_package(p_workspace_id,v_attempt.quiz_version_id);
  v_runtime_hash := public.flh_paper_exam_runtime_hash(p_workspace_id,v_attempt.quiz_version_id);
  v_stored_runtime_hash := nullif(v_paper->>'paper_runtime_content_hash','');
  if v_runtime_package is null or v_runtime_hash is null or v_stored_runtime_hash is null
     or v_runtime_hash is distinct from v_stored_runtime_hash
     or v_attempt.metadata->>'paper_runtime_content_hash' is distinct from v_runtime_hash then
    return jsonb_build_object('ok',false,'error','PAPER_RUNTIME_HASH_MISMATCH');
  end if;

  if v_paper->'paper_canonical_package' is not null then
    v_canonical_hash := encode(
      extensions.digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),
      'hex'
    );
    if v_canonical_hash is distinct from v_paper->>'paper_content_hash' then
      return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_HASH_MISMATCH');
    end if;
    if v_paper->'paper_canonical_package' is distinct from v_runtime_package then
      return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_PACKAGE_DRIFT');
    end if;
  elsif coalesce((v_paper->>'paper_legacy_registration')::boolean,false) is true then
    if v_paper->'paper_runtime_package_snapshot' is null
       or v_paper->'paper_runtime_package_snapshot' is distinct from v_runtime_package then
      return jsonb_build_object('ok',false,'error','PAPER_LEGACY_PACKAGE_DRIFT');
    end if;
  else
    return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_PACKAGE_MISSING');
  end if;

  select count(*),count(distinct question_id)
    into v_queue_count,v_unique_count
  from public.quiz_attempt_question_queue
  where workspace_id=p_workspace_id and quiz_attempt_id=p_attempt_id;
  if v_queue_count <> v_count or v_unique_count <> v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUEUE_COUNT_MISMATCH');
  end if;

  select count(*) into v_exact_count
  from generate_series(1,v_count) g(n)
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=p_workspace_id
   and qq.quiz_attempt_id=p_attempt_id
   and qq.sequence_no=g.n
  join public.quiz_questions q
    on q.workspace_id=qq.workspace_id
   and q.id=qq.question_id
   and q.quiz_version_id=v_attempt.quiz_version_id
  join public.quiz_question_answer_keys k
    on k.workspace_id=q.workspace_id and k.question_id=q.id
  where qq.question_id::text = v_map->(g.n::text)->>'question_id'
    and q.question_code = v_map->(g.n::text)->>'question_code';
  if v_exact_count <> v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUEUE_MAP_MISMATCH');
  end if;

  select count(*) into v_bad_option_maps
  from generate_series(1,v_count) g(n)
  where jsonb_typeof(v_map->(g.n::text)->'option_positions') is distinct from 'object'
     or jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb)) < 1
     or (
       select count(distinct m.value)
       from jsonb_each_text(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb)) m
     ) <> jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))
     or (
       select count(*)
       from public.quiz_question_options o
       where o.workspace_id=p_workspace_id
         and o.question_id::text=v_map->(g.n::text)->>'question_id'
     ) <> jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))
     or exists (
       select 1
       from jsonb_each_text(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb)) m
       where m.value !~ '^[1-9][0-9]*$'
          or not exists (
            select 1
            from public.quiz_question_options o
            where o.workspace_id=p_workspace_id
              and o.question_id::text=v_map->(g.n::text)->>'question_id'
              and o.position=case when m.value ~ '^[1-9][0-9]*$' then m.value::integer else -1 end
          )
     );
  if v_bad_option_maps <> 0 then
    return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_MISMATCH');
  end if;

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

create or replace function public.flh_paper_exam_start_legacy_flh020(
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
  v_version record;
  v_paper jsonb;
  v_map jsonb;
  v_count integer;
  v_code_count integer;
  v_existing record;
  v_assignment_id uuid;
  v_attempt_id uuid;
  v_question_id uuid;
  v_difficulty smallint;
  v_runtime_package jsonb;
  v_runtime_hash text;
  v_validation jsonb;
  i integer;
begin
  if nullif(trim(p_paper_model_code),'') is null then
    return jsonb_build_object('error','PAPER_MODEL_CODE_REQUIRED');
  end if;
  if not exists (
    select 1 from public.learners
    where workspace_id=p_workspace_id and id=p_learner_id and is_active=true
  ) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_learner_id::text || ':' || p_quiz_version_id::text || ':' || p_paper_model_code,
    0
  ));

  select v.id,v.quiz_id,v.settings,q.slug,q.title
    into v_version
  from public.quiz_versions v
  join public.quizzes q
    on q.workspace_id=v.workspace_id and q.id=v.quiz_id and q.status='active'
  where v.workspace_id=p_workspace_id and v.id=p_quiz_version_id and v.state='published'
  limit 1;
  if not found then return jsonb_build_object('error','PAPER_VERSION_NOT_FOUND'); end if;

  v_paper := v_version.settings->'paper_exam';
  if v_paper is null or jsonb_typeof(v_paper) <> 'object' then
    return jsonb_build_object('error','PAPER_METADATA_MISSING');
  end if;
  if nullif(v_paper->>'paper_model_code','') is null
     or v_paper->>'paper_model_code' is distinct from p_paper_model_code then
    return jsonb_build_object('error','PAPER_MODEL_MISMATCH');
  end if;

  select count(*) into v_code_count
  from public.quiz_versions
  where workspace_id=p_workspace_id
    and state='published'
    and settings->'paper_exam'->>'paper_model_code'=p_paper_model_code;
  if v_code_count <> 1 then
    return jsonb_build_object('error','PAPER_MODEL_NOT_UNIQUE','matching_versions',v_code_count);
  end if;

  begin
    v_count := (v_paper->>'paper_question_count')::integer;
  exception when others then
    return jsonb_build_object('error','PAPER_QUESTION_COUNT_INVALID');
  end;
  v_map := v_paper->'paper_question_map';
  if v_count is null or v_count < 1
     or v_map is null or jsonb_typeof(v_map) <> 'object'
     or jsonb_object_length(v_map) <> v_count
     or nullif(v_paper->>'paper_content_hash','') is null then
    return jsonb_build_object('error','PAPER_BINDING_INVALID');
  end if;

  v_runtime_package := public.flh_paper_exam_runtime_package(p_workspace_id,p_quiz_version_id);
  v_runtime_hash := public.flh_paper_exam_runtime_hash(p_workspace_id,p_quiz_version_id);
  if v_runtime_package is null or v_runtime_hash is null
     or v_runtime_hash is distinct from nullif(v_paper->>'paper_runtime_content_hash','') then
    return jsonb_build_object('error','PAPER_RUNTIME_HASH_MISMATCH');
  end if;
  if v_paper->'paper_canonical_package' is not null then
    if encode(extensions.digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),'hex') is distinct from v_paper->>'paper_content_hash'
       or v_paper->'paper_canonical_package' is distinct from v_runtime_package then
      return jsonb_build_object('error','PAPER_CANONICAL_BINDING_MISMATCH');
    end if;
  elsif coalesce((v_paper->>'paper_legacy_registration')::boolean,false) is true then
    if v_paper->'paper_runtime_package_snapshot' is null
       or v_paper->'paper_runtime_package_snapshot' is distinct from v_runtime_package then
      return jsonb_build_object('error','PAPER_LEGACY_BINDING_MISMATCH');
    end if;
  else
    return jsonb_build_object('error','PAPER_CANONICAL_PACKAGE_MISSING');
  end if;

  if exists (
    select 1 from public.quiz_attempts
    where workspace_id=p_workspace_id
      and learner_id=p_learner_id
      and status='submitted'
      and metadata->>'paper_model_code'=p_paper_model_code
  ) then
    return jsonb_build_object('error','PAPER_ALREADY_INGESTED');
  end if;

  select id into v_existing
  from public.quiz_attempts
  where workspace_id=p_workspace_id
    and learner_id=p_learner_id
    and quiz_version_id=p_quiz_version_id
    and status='in_progress'
    and delivery_mode='exam'
    and metadata->>'paper_model_code'=p_paper_model_code
  order by started_at desc
  limit 1;
  if found then
    v_validation := public.flh_paper_exam_validate_queue(p_workspace_id,v_existing.id);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      return jsonb_build_object('error','PAPER_EXISTING_ATTEMPT_INVALID','validation',v_validation);
    end if;
    return jsonb_build_object(
      'ok',true,'resumed',true,'attempt_id',v_existing.id,
      'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
      'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash'
    );
  end if;

  select id into v_assignment_id
  from public.quiz_assignments
  where workspace_id=p_workspace_id
    and learner_id=p_learner_id
    and quiz_version_id=p_quiz_version_id
  order by created_at desc
  limit 1;
  if v_assignment_id is null then
    insert into public.quiz_assignments(
      workspace_id,learner_id,quiz_version_id,status,available_at,metadata
    ) values (
      p_workspace_id,p_learner_id,p_quiz_version_id,'assigned',now(),
      jsonb_build_object('source','paper_exam','paper_model_code',p_paper_model_code)
    ) returning id into v_assignment_id;
  end if;

  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,assignment_id,status,delivery_mode,metadata
  ) values (
    p_workspace_id,p_learner_id,p_quiz_version_id,v_assignment_id,'in_progress','exam',
    jsonb_build_object(
      'engine','paper-exam-v1','server_graded',true,'server_state',true,
      'paper_model_code',p_paper_model_code,
      'paper_quiz_version_id',p_quiz_version_id::text,
      'paper_content_hash',v_paper->>'paper_content_hash',
      'paper_runtime_content_hash',v_runtime_hash,
      'paper_question_count',v_count,
      'paper_queue_validated',false,
      'paper_ingested',false,
      'paper_source',coalesce(nullif(trim(p_source),''),'uploaded_photos')
    )
  ) returning id into v_attempt_id;

  for i in 1..v_count loop
    select q.id,q.difficulty_level into v_question_id,v_difficulty
    from public.quiz_questions q
    join public.quiz_question_answer_keys k
      on k.workspace_id=q.workspace_id and k.question_id=q.id
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.id::text=v_map->(i::text)->>'question_id'
      and q.question_code=v_map->(i::text)->>'question_code'
    limit 1;
    if not found then raise exception 'PAPER_QUESTION_MAP_INVALID:%',i; end if;

    insert into public.quiz_attempt_question_queue(
      workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,
      difficulty_level,status,selection_reason
    ) values (
      p_workspace_id,v_attempt_id,i,v_question_id,'core',v_difficulty,
      case when i=1 then 'active' else 'pending' end,'paper_exact_mapping'
    );
  end loop;

  v_validation := public.flh_paper_exam_validate_queue(p_workspace_id,v_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;

  update public.quiz_attempts
  set metadata=metadata || jsonb_build_object('paper_queue_validated',true)
  where workspace_id=p_workspace_id and id=v_attempt_id;

  return jsonb_build_object(
    'ok',true,'resumed',false,'attempt_id',v_attempt_id,
    'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
    'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash'
  );
end;
$function$;

create or replace function public.flh_paper_exam_submit_legacy_flh020(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_unanswered_sequence_nos integer[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_validation jsonb;
  v_missing integer[] := '{}'::integer[];
  v_declared integer[] := '{}'::integer[];
  v_declared_count integer := 0;
  v_declared_distinct_count integer := 0;
  v_invalid_declared_count integer := 0;
  v_result jsonb;
begin
  select a.id,a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id
    and a.id=p_attempt_id
    and a.learner_id=p_learner_id
    and a.status='in_progress'
    and a.delivery_mode='exam'
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE');
  end if;

  if nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return jsonb_build_object('error','PAPER_ATTEMPT_REQUIRED');
  end if;

  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_QUEUE_NOT_VALIDATED');
  end if;

  v_validation := public.flh_paper_exam_validate_queue(p_workspace_id,p_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    return jsonb_build_object(
      'error','PAPER_QUEUE_VALIDATION_FAILED',
      'reason',coalesce(v_validation->>'error','UNKNOWN')
    );
  end if;

  if p_unanswered_sequence_nos is null then
    p_unanswered_sequence_nos := '{}'::integer[];
  end if;

  if array_position(p_unanswered_sequence_nos,null) is not null then
    return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID');
  end if;

  select
    count(*),
    count(distinct x),
    coalesce(array_agg(distinct x order by x),'{}'::integer[])
  into v_declared_count,v_declared_distinct_count,v_declared
  from unnest(p_unanswered_sequence_nos) x;

  if v_declared_count <> v_declared_distinct_count then
    return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID');
  end if;

  select count(*) into v_invalid_declared_count
  from unnest(v_declared) x
  where not exists (
    select 1
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id=p_workspace_id
      and qq.quiz_attempt_id=p_attempt_id
      and qq.sequence_no=x
  );

  if v_invalid_declared_count <> 0 then
    return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID');
  end if;

  select coalesce(array_agg(qq.sequence_no order by qq.sequence_no),'{}'::integer[])
    into v_missing
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id
    and qq.quiz_attempt_id=p_attempt_id
    and not exists (
      select 1
      from public.quiz_attempt_answers aa
      where aa.workspace_id=qq.workspace_id
        and aa.attempt_id=qq.quiz_attempt_id
        and aa.question_id=qq.question_id
    );

  if v_declared is distinct from v_missing then
    return jsonb_build_object(
      'error','PAPER_UNANSWERED_SET_MISMATCH',
      'declared_count',cardinality(v_declared),
      'missing_count',cardinality(v_missing)
    );
  end if;

  if cardinality(v_declared) > 0 then
    perform set_config('flh.paper_unanswered_attempt_id',p_attempt_id::text,true);

    insert into public.quiz_attempt_answers (
      workspace_id,attempt_id,question_id,response,evaluation,
      is_correct,points_awarded,answered_at,attempts_used,hints_used,
      first_try_correct,mastery_result
    )
    select
      qq.workspace_id,qq.quiz_attempt_id,qq.question_id,
      '{"unanswered":true}'::jsonb,'ungraded',
      null,null,clock_timestamp(),0,0,null,null
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id=p_workspace_id
      and qq.quiz_attempt_id=p_attempt_id
      and qq.sequence_no=any(v_declared)
      and not exists (
        select 1
        from public.quiz_attempt_answers aa
        where aa.workspace_id=qq.workspace_id
          and aa.attempt_id=qq.quiz_attempt_id
          and aa.question_id=qq.question_id
      );

    perform set_config('flh.paper_unanswered_attempt_id','',true);
  end if;

  v_result := public.flh_exam_submit(p_workspace_id,p_learner_id,p_attempt_id);
  return v_result;
end;
$function$;


revoke all on function public.flh_paper_exam_runtime_package_legacy_flh020(uuid,uuid) from public,anon,authenticated;
revoke all on function public.flh_paper_exam_validate_queue_legacy_flh020(uuid,uuid) from public,anon,authenticated;
revoke all on function public.flh_paper_exam_start_legacy_flh020(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.flh_paper_exam_submit_legacy_flh020(uuid,uuid,uuid,integer[]) from public,anon,authenticated;



create or replace function public.flh_support_paper_runtime_package(
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
  v_map jsonb;
  v_count integer;
  v_item jsonb;
  v_question_id text;
  v_question_code text;
  v_prompt text;
  v_question_type text;
  v_grading_mode text;
  v_options jsonb;
  v_correct jsonb;
  v_package jsonb := '[]'::jsonb;
  i integer;
begin
  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id=p_workspace_id
    and id=p_quiz_version_id
    and state='published'
    and coalesce((settings->>'support_source')::boolean,false);
  if v_paper is null or jsonb_typeof(v_paper)<>'object' then return null; end if;

  begin v_count:=(v_paper->>'paper_question_count')::integer;
  exception when others then return null; end;
  if v_count is null or v_count<1 then return null; end if;
  v_map:=v_paper->'paper_question_map';
  if v_map is null or jsonb_typeof(v_map)<>'object' or jsonb_object_length(v_map)<>v_count then return null; end if;

  for i in 1..v_count loop
    v_item:=v_map->(i::text);
    if v_item is null or jsonb_typeof(v_item)<>'object' then return null; end if;
    v_question_id:=nullif(v_item->>'question_id','');
    if v_question_id is null then return null; end if;

    select q.question_code,q.prompt,q.question_type,
           coalesce(q.source_metadata->>'grading_mode','graded'),
           coalesce((
             select jsonb_agg(jsonb_build_object('position',o.position,'label',o.label,'content',o.content) order by o.position)
             from public.quiz_question_options o
             where o.workspace_id=q.workspace_id and o.question_id=q.id
           ),'[]'::jsonb),
           k.correct_answer
      into v_question_code,v_prompt,v_question_type,v_grading_mode,v_options,v_correct
    from public.quiz_questions q
    left join public.quiz_question_answer_keys k
      on k.workspace_id=q.workspace_id and k.question_id=q.id
    where q.workspace_id=p_workspace_id
      and q.quiz_version_id=p_quiz_version_id
      and q.id::text=v_question_id
    limit 1;

    if not found then return null; end if;
    if v_grading_mode<>'ungraded' and v_correct is null then return null; end if;

    v_package:=v_package||jsonb_build_array(jsonb_build_object(
      'paper_question_number',i,
      'question_code',v_question_code,
      'prompt',v_prompt,
      'question_type',v_question_type,
      'grading_mode',v_grading_mode,
      'options',v_options,
      'correct_answer',v_correct
    ));
  end loop;
  return v_package;
end;
$function$;

revoke all on function public.flh_support_paper_runtime_package(uuid,uuid) from public;
revoke all on function public.flh_support_paper_runtime_package(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_support_paper_runtime_package(uuid,uuid) to service_role;

create or replace function public.flh_support_paper_validate_queue(
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
  v_paper jsonb;
  v_map jsonb;
  v_count integer;
  v_queue_count integer;
  v_unique_count integer;
  v_exact_count integer;
  v_bad_maps integer;
  v_runtime_package jsonb;
  v_runtime_hash text;
  v_canonical_hash text;
begin
  select a.quiz_version_id,a.delivery_mode,a.metadata
    into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id
  limit 1;
  if not found or v_attempt.delivery_mode<>'exam' then
    return jsonb_build_object('ok',false,'error','PAPER_ATTEMPT_NOT_FOUND');
  end if;
  if nullif(v_attempt.metadata->>'paper_model_code','') is null then
    return jsonb_build_object('ok',false,'error','NOT_PAPER_ATTEMPT');
  end if;

  select settings->'paper_exam' into v_paper
  from public.quiz_versions
  where workspace_id=p_workspace_id and id=v_attempt.quiz_version_id and state='published'
    and coalesce((settings->>'support_source')::boolean,false);
  if v_paper is null or jsonb_typeof(v_paper)<>'object' then
    return jsonb_build_object('ok',false,'error','PAPER_METADATA_MISSING');
  end if;

  if nullif(v_paper->>'paper_model_code','') is null
     or v_paper->>'paper_model_code' is distinct from v_attempt.metadata->>'paper_model_code' then
    return jsonb_build_object('ok',false,'error','PAPER_MODEL_MISMATCH');
  end if;
  if v_attempt.metadata->>'paper_quiz_version_id' is distinct from v_attempt.quiz_version_id::text then
    return jsonb_build_object('ok',false,'error','PAPER_VERSION_MISMATCH');
  end if;
  if nullif(v_paper->>'paper_content_hash','') is null
     or v_paper->>'paper_content_hash' is distinct from v_attempt.metadata->>'paper_content_hash' then
    return jsonb_build_object('ok',false,'error','PAPER_CONTENT_HASH_MISMATCH');
  end if;

  begin v_count:=(v_paper->>'paper_question_count')::integer;
  exception when others then return jsonb_build_object('ok',false,'error','PAPER_QUESTION_COUNT_INVALID'); end;
  v_map:=v_paper->'paper_question_map';
  if v_count is null or v_count<1 or v_map is null or jsonb_typeof(v_map)<>'object' or jsonb_object_length(v_map)<>v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUESTION_MAP_INVALID');
  end if;

  v_runtime_package:=public.flh_support_paper_runtime_package(p_workspace_id,v_attempt.quiz_version_id);
  if v_runtime_package is null then return jsonb_build_object('ok',false,'error','PAPER_RUNTIME_PACKAGE_INVALID'); end if;
  v_runtime_hash:=encode(extensions.digest(convert_to(v_runtime_package::text,'UTF8'),'sha256'),'hex');
  if nullif(v_paper->>'paper_runtime_content_hash','') is null
     or v_runtime_hash is distinct from v_paper->>'paper_runtime_content_hash'
     or v_attempt.metadata->>'paper_runtime_content_hash' is distinct from v_runtime_hash then
    return jsonb_build_object('ok',false,'error','PAPER_RUNTIME_HASH_MISMATCH');
  end if;
  if v_paper->'paper_canonical_package' is null or v_paper->'paper_canonical_package' is distinct from v_runtime_package then
    return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_PACKAGE_DRIFT');
  end if;
  v_canonical_hash:=encode(extensions.digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),'hex');
  if v_canonical_hash is distinct from v_paper->>'paper_content_hash' then
    return jsonb_build_object('ok',false,'error','PAPER_CANONICAL_HASH_MISMATCH');
  end if;

  select count(*),count(distinct question_id)
    into v_queue_count,v_unique_count
  from public.quiz_attempt_question_queue
  where workspace_id=p_workspace_id and quiz_attempt_id=p_attempt_id;
  if v_queue_count<>v_count or v_unique_count<>v_count then
    return jsonb_build_object('ok',false,'error','PAPER_QUEUE_COUNT_MISMATCH');
  end if;

  select count(*) into v_exact_count
  from generate_series(1,v_count) g(n)
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id and qq.sequence_no=g.n
  join public.quiz_questions q
    on q.workspace_id=qq.workspace_id and q.id=qq.question_id and q.quiz_version_id=v_attempt.quiz_version_id
  where qq.question_id::text=v_map->(g.n::text)->>'question_id'
    and q.question_code=v_map->(g.n::text)->>'question_code';
  if v_exact_count<>v_count then return jsonb_build_object('ok',false,'error','PAPER_QUEUE_MAP_MISMATCH'); end if;

  select count(*) into v_bad_maps
  from generate_series(1,v_count) g(n)
  join public.quiz_questions q
    on q.workspace_id=p_workspace_id
   and q.quiz_version_id=v_attempt.quiz_version_id
   and q.id::text=v_map->(g.n::text)->>'question_id'
  where
    (q.question_type='single_choice' and (
      jsonb_typeof(v_map->(g.n::text)->'option_positions') is distinct from 'object'
      or jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))<2
      or (select count(distinct m.value) from jsonb_each_text(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb)) m)
         <>jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))
      or (select count(*) from public.quiz_question_options o where o.workspace_id=p_workspace_id and o.question_id=q.id)
         <>jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))
      or exists (
        select 1 from jsonb_each_text(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb)) m
        where m.value!~'^[1-9][0-9]*$'
           or not exists (
             select 1 from public.quiz_question_options o
             where o.workspace_id=p_workspace_id and o.question_id=q.id and o.position=m.value::integer
           )
      )
    ))
    or
    (q.question_type<>'single_choice' and (
      jsonb_typeof(v_map->(g.n::text)->'option_positions') is distinct from 'object'
      or jsonb_object_length(coalesce(v_map->(g.n::text)->'option_positions','{}'::jsonb))<>0
    ));
  if v_bad_maps<>0 then return jsonb_build_object('ok',false,'error','PAPER_OPTION_MAP_MISMATCH'); end if;

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

revoke all on function public.flh_support_paper_validate_queue(uuid,uuid) from public;
revoke all on function public.flh_support_paper_validate_queue(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_support_paper_validate_queue(uuid,uuid) to service_role;

create or replace function public.flh_support_workbook_paper_validate_queue(
  p_workspace_id uuid,
  p_attempt_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path to 'public'
as $function$
  select public.flh_support_paper_validate_queue(p_workspace_id,p_attempt_id);
$function$;

revoke all on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) from public;
revoke all on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_support_workbook_paper_validate_queue(uuid,uuid) to service_role;

create or replace function public.flh_support_paper_start(
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
  v_version record;
  v_paper jsonb;
  v_map jsonb;
  v_count integer;
  v_code_count integer;
  v_existing uuid;
  v_assignment_id uuid;
  v_attempt_id uuid;
  v_question_id uuid;
  v_difficulty smallint;
  v_runtime_package jsonb;
  v_runtime_hash text;
  v_validation jsonb;
  i integer;
begin
  if nullif(btrim(p_paper_model_code),'') is null then return jsonb_build_object('error','PAPER_MODEL_CODE_REQUIRED'); end if;
  if not exists(select 1 from public.learners where workspace_id=p_workspace_id and id=p_learner_id and is_active) then
    return jsonb_build_object('error','LEARNER_NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text||':'||p_learner_id::text||':'||p_quiz_version_id::text||':'||p_paper_model_code,0
  ));

  select v.id,v.quiz_id,v.settings,q.slug,q.title
    into v_version
  from public.quiz_versions v
  join public.quizzes q on q.workspace_id=v.workspace_id and q.id=v.quiz_id and q.status='active'
  where v.workspace_id=p_workspace_id and v.id=p_quiz_version_id and v.state='published'
    and coalesce((v.settings->>'support_source')::boolean,false)
  limit 1;
  if not found then return jsonb_build_object('error','PAPER_VERSION_NOT_FOUND'); end if;

  if not (
    exists (
      select 1
      from public.learner_program_enrollments e
      join public.learning_programs lp
        on lp.workspace_id=e.workspace_id and lp.id=e.program_id and lp.status='active'
      join public.program_quizzes pq
        on pq.workspace_id=e.workspace_id and pq.program_id=e.program_id
       and pq.quiz_id=v_version.quiz_id and pq.availability='available'
      where e.workspace_id=p_workspace_id and e.learner_id=p_learner_id and e.status='active'
    )
    or exists (
      select 1
      from public.quiz_assignments qa
      where qa.workspace_id=p_workspace_id and qa.learner_id=p_learner_id
        and qa.quiz_version_id=p_quiz_version_id and qa.status in ('assigned','in_progress')
        and (qa.available_at is null or qa.available_at<=now())
        and (qa.due_at is null or qa.due_at>=now())
    )
  ) then
    return jsonb_build_object('error','QUIZ_NOT_AVAILABLE');
  end if;

  v_paper:=v_version.settings->'paper_exam';
  if v_paper is null or jsonb_typeof(v_paper)<>'object' then return jsonb_build_object('error','PAPER_METADATA_MISSING'); end if;
  if nullif(v_paper->>'paper_model_code','') is null or v_paper->>'paper_model_code' is distinct from p_paper_model_code then
    return jsonb_build_object('error','PAPER_MODEL_MISMATCH');
  end if;

  select count(*) into v_code_count
  from public.quiz_versions
  where workspace_id=p_workspace_id and state='published'
    and settings->'paper_exam'->>'paper_model_code'=p_paper_model_code;
  if v_code_count<>1 then return jsonb_build_object('error','PAPER_MODEL_NOT_UNIQUE','matching_versions',v_code_count); end if;

  begin v_count:=(v_paper->>'paper_question_count')::integer;
  exception when others then return jsonb_build_object('error','PAPER_QUESTION_COUNT_INVALID'); end;
  v_map:=v_paper->'paper_question_map';
  if v_count is null or v_count<1 or v_map is null or jsonb_typeof(v_map)<>'object'
     or jsonb_object_length(v_map)<>v_count or nullif(v_paper->>'paper_content_hash','') is null then
    return jsonb_build_object('error','PAPER_BINDING_INVALID');
  end if;

  v_runtime_package:=public.flh_support_paper_runtime_package(p_workspace_id,p_quiz_version_id);
  if v_runtime_package is null then return jsonb_build_object('error','PAPER_RUNTIME_HASH_MISMATCH'); end if;
  v_runtime_hash:=encode(extensions.digest(convert_to(v_runtime_package::text,'UTF8'),'sha256'),'hex');
  if v_runtime_hash is distinct from nullif(v_paper->>'paper_runtime_content_hash','')
     or v_paper->'paper_canonical_package' is distinct from v_runtime_package
     or encode(extensions.digest(convert_to((v_paper->'paper_canonical_package')::text,'UTF8'),'sha256'),'hex')
        is distinct from v_paper->>'paper_content_hash' then
    return jsonb_build_object('error','PAPER_CANONICAL_BINDING_MISMATCH');
  end if;

  if exists (
    select 1 from public.quiz_attempts
    where workspace_id=p_workspace_id and learner_id=p_learner_id and status='submitted'
      and metadata->>'paper_model_code'=p_paper_model_code
  ) then return jsonb_build_object('error','PAPER_ALREADY_INGESTED'); end if;

  select id into v_existing
  from public.quiz_attempts
  where workspace_id=p_workspace_id and learner_id=p_learner_id and quiz_version_id=p_quiz_version_id
    and status='in_progress' and delivery_mode='exam' and metadata->>'paper_model_code'=p_paper_model_code
  order by started_at desc limit 1;
  if found then
    v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,v_existing);
    if coalesce((v_validation->>'ok')::boolean,false) is not true then
      return jsonb_build_object('error','PAPER_EXISTING_ATTEMPT_INVALID','validation',v_validation);
    end if;
    return jsonb_build_object('ok',true,'resumed',true,'attempt_id',v_existing,
      'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
      'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash');
  end if;

  select id into v_assignment_id
  from public.quiz_assignments
  where workspace_id=p_workspace_id and learner_id=p_learner_id and quiz_version_id=p_quiz_version_id
  order by created_at desc limit 1;
  if v_assignment_id is null then
    insert into public.quiz_assignments(workspace_id,learner_id,quiz_version_id,status,available_at,metadata)
    values(p_workspace_id,p_learner_id,p_quiz_version_id,'assigned',now(),
      jsonb_build_object('source','support_workbook_paper','paper_model_code',p_paper_model_code))
    returning id into v_assignment_id;
  end if;

  insert into public.quiz_attempts(
    workspace_id,learner_id,quiz_version_id,assignment_id,status,delivery_mode,metadata
  ) values (
    p_workspace_id,p_learner_id,p_quiz_version_id,v_assignment_id,'in_progress','exam',
    jsonb_build_object(
      'engine','support-paper-exam-v1','server_graded',true,'server_state',true,
      'delivery_surface','paper','support_workbook_paper',true,
      'support_source',true,'support_source_code',v_version.settings->>'source_code',
      'support_session_slug',v_version.slug,
      'support_question_map_hash',encode(extensions.digest(convert_to(v_map::text,'UTF8'),'sha256'),'hex'),
      'paper_model_code',p_paper_model_code,
      'paper_quiz_version_id',p_quiz_version_id::text,
      'paper_content_hash',v_paper->>'paper_content_hash',
      'paper_runtime_content_hash',v_runtime_hash,
      'paper_question_count',v_count,
      'paper_queue_validated',false,'paper_ingested',false,
      'paper_source',coalesce(nullif(btrim(p_source),''),'uploaded_photos')
    )
  ) returning id into v_attempt_id;

  for i in 1..v_count loop
    select q.id,q.difficulty_level into v_question_id,v_difficulty
    from public.quiz_questions q
    where q.workspace_id=p_workspace_id and q.quiz_version_id=p_quiz_version_id
      and q.id::text=v_map->(i::text)->>'question_id'
      and q.question_code=v_map->(i::text)->>'question_code'
    limit 1;
    if not found then raise exception 'PAPER_QUESTION_MAP_INVALID:%',i; end if;

    insert into public.quiz_attempt_question_queue(
      workspace_id,quiz_attempt_id,sequence_no,question_id,source_role,difficulty_level,status,selection_reason
    ) values (
      p_workspace_id,v_attempt_id,i,v_question_id,'core',v_difficulty,
      case when i=1 then 'active' else 'pending' end,'support_paper_exact_mapping'
    );
  end loop;

  v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,v_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;
  update public.quiz_attempts
  set metadata=metadata||jsonb_build_object('paper_queue_validated',true)
  where workspace_id=p_workspace_id and id=v_attempt_id;

  return jsonb_build_object('ok',true,'resumed',false,'attempt_id',v_attempt_id,
    'quiz_version_id',p_quiz_version_id,'paper_model_code',p_paper_model_code,
    'paper_question_count',v_count,'paper_content_hash',v_paper->>'paper_content_hash');
end;
$function$;

revoke all on function public.flh_support_paper_start(uuid,uuid,uuid,text,text) from public;
revoke all on function public.flh_support_paper_start(uuid,uuid,uuid,text,text) from anon,authenticated;
grant execute on function public.flh_support_paper_start(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.flh_support_paper_exam_save_response(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_question record;
  v_validation jsonb;
  v_value text;
  v_position integer;
begin
  if p_response is null or jsonb_typeof(p_response)<>'object' then
    return jsonb_build_object('error','INVALID_ANSWER');
  end if;

  select a.quiz_version_id,a.metadata into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id and a.learner_id=p_learner_id
    and a.status='in_progress' and a.delivery_mode='exam'
  limit 1 for update;
  if not found then return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE'); end if;

  if not exists (
    select 1 from public.quiz_versions v
    where v.workspace_id=p_workspace_id and v.id=v_attempt.quiz_version_id and v.state='published'
      and coalesce((v.settings->>'support_source')::boolean,false)
  ) then return jsonb_build_object('error','SUPPORT_PAPER_ATTEMPT_REQUIRED'); end if;

  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_QUEUE_NOT_VALIDATED');
  end if;
  v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,p_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_QUEUE_VALIDATION_FAILED','reason',v_validation->>'error');
  end if;

  select q.id,q.question_type,coalesce(q.source_metadata->>'grading_mode','graded') as grading_mode
    into v_question
  from public.quiz_questions q
  join public.quiz_attempt_question_queue qq
    on qq.workspace_id=q.workspace_id and qq.question_id=q.id
   and qq.quiz_attempt_id=p_attempt_id
  where q.workspace_id=p_workspace_id and q.id=p_question_id and q.quiz_version_id=v_attempt.quiz_version_id
  limit 1;
  if not found then return jsonb_build_object('error','ATTEMPT_OR_QUESTION_NOT_ACTIVE'); end if;

  if v_question.question_type='single_choice' then
    if jsonb_object_length(p_response)<>1 or not (p_response?'option_position') then
      return jsonb_build_object('error','INVALID_ANSWER');
    end if;
    begin v_position:=nullif(p_response->>'option_position','')::integer;
    exception when others then return jsonb_build_object('error','INVALID_ANSWER'); end;
    if v_position is null or not exists (
      select 1 from public.quiz_question_options o
      where o.workspace_id=p_workspace_id and o.question_id=p_question_id and o.position=v_position
    ) then return jsonb_build_object('error','INVALID_ANSWER'); end if;
  elsif v_question.question_type in ('numeric','short_answer') then
    if jsonb_object_length(p_response)<>1 or not (p_response?'value') or jsonb_typeof(p_response->'value')<>'string' then
      return jsonb_build_object('error','INVALID_ANSWER');
    end if;
    v_value:=p_response->>'value';
    if nullif(btrim(v_value),'') is null or char_length(v_value)>2000 then
      return jsonb_build_object('error','INVALID_ANSWER');
    end if;
    if v_question.question_type='numeric' then
      begin perform replace(btrim(v_value),',','.')::numeric;
      exception when others then return jsonb_build_object('error','INVALID_ANSWER'); end;
    end if;
  else
    return jsonb_build_object('error','UNSUPPORTED_QUESTION_TYPE');
  end if;

  insert into public.quiz_attempt_answers(
    workspace_id,attempt_id,question_id,response,evaluation,is_correct,points_awarded,
    answered_at,attempts_used,hints_used,first_try_correct,mastery_result
  ) values (
    p_workspace_id,p_attempt_id,p_question_id,p_response,'ungraded',null,null,
    clock_timestamp(),1,0,null,null
  )
  on conflict (attempt_id,question_id) do update set
    response=excluded.response,evaluation='ungraded',is_correct=null,points_awarded=null,
    answered_at=clock_timestamp(),attempts_used=1,hints_used=0,first_try_correct=null,mastery_result=null;

  return jsonb_build_object('ok',true,'response',p_response);
end;
$function$;

revoke all on function public.flh_support_paper_exam_save_response(uuid,uuid,uuid,uuid,jsonb) from public;
revoke all on function public.flh_support_paper_exam_save_response(uuid,uuid,uuid,uuid,jsonb) from anon,authenticated;
grant execute on function public.flh_support_paper_exam_save_response(uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.flh_support_record_exam_concept_mastery(
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
  v_queue_count integer;
  v_answer_count integer;
  v_graded_count integer;
  v_evaluated_count integer;
  v_evidence_count integer:=0;
  v_concept_count integer:=0;
  v_old record;
  v_new_score numeric;
  v_assessed_at timestamptz;
  r record;
begin
  select a.learner_id,a.status,a.delivery_mode,a.submitted_at,a.metadata into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id for update;
  if not found then return jsonb_build_object('ok',false,'error','ATTEMPT_NOT_FOUND'); end if;
  if v_attempt.status<>'submitted' or v_attempt.delivery_mode<>'exam' then
    return jsonb_build_object('ok',false,'error','NOT_SUBMITTED_EXAM');
  end if;
  if coalesce((v_attempt.metadata->>'concept_mastery_recorded')::boolean,false) then
    return jsonb_build_object('ok',true,'already_recorded',true);
  end if;

  select count(*),count(aa.question_id),
         count(*) filter (where coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded'),
         count(*) filter (where coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded' and aa.is_correct is not null)
    into v_queue_count,v_answer_count,v_graded_count,v_evaluated_count
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q on q.workspace_id=qq.workspace_id and q.id=qq.question_id
  left join public.quiz_attempt_answers aa
    on aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id;

  if v_queue_count<1 or v_answer_count<>v_queue_count or v_evaluated_count<>v_graded_count then
    return jsonb_build_object('ok',false,'error','EXAM_MASTERY_EVALUATION_INCOMPLETE');
  end if;

  v_assessed_at:=coalesce(v_attempt.submitted_at,clock_timestamp());

  for r in
    select qc.concept_id,count(*)::integer evidence_count,
           count(*) filter(where aa.is_correct)::integer correct_count,
           count(*) filter(where aa.first_try_correct)::integer first_try_count,
           (array_agg(q.difficulty_level order by qq.sequence_no desc))[1]::smallint last_difficulty
    from public.quiz_attempt_question_queue qq
    join public.quiz_attempt_answers aa
      on aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id
    join public.quiz_questions q on q.workspace_id=qq.workspace_id and q.id=qq.question_id
    join public.quiz_question_concepts qc
      on qc.workspace_id=q.workspace_id and qc.question_id=q.id and qc.is_primary
    where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id
      and coalesce(q.source_metadata->>'grading_mode','graded')<>'ungraded'
    group by qc.concept_id
  loop
    select m.mastery_score,m.evidence_count,m.first_try_correct_count,m.total_question_count,m.total_hint_count,m.metadata
      into v_old
    from public.learner_concept_mastery m
    where m.workspace_id=p_workspace_id and m.learner_id=v_attempt.learner_id and m.concept_id=r.concept_id
    for update;

    if found then
      v_new_score:=round((coalesce(v_old.mastery_score,0)*coalesce(v_old.evidence_count,0)+r.correct_count*100.0)
        /(coalesce(v_old.evidence_count,0)+r.evidence_count),2);
      update public.learner_concept_mastery
      set mastery_score=v_new_score,
          evidence_count=coalesce(v_old.evidence_count,0)+r.evidence_count,
          first_try_correct_count=coalesce(v_old.first_try_correct_count,0)+r.first_try_count,
          total_question_count=coalesce(v_old.total_question_count,0)+r.evidence_count,
          total_hint_count=coalesce(v_old.total_hint_count,0),
          last_difficulty=r.last_difficulty,last_assessed_at=v_assessed_at,
          metadata=coalesce(v_old.metadata,'{}'::jsonb)||jsonb_build_object(
            'last_evidence_mode','support_paper','last_exam_attempt_id',p_attempt_id,
            'last_exam_correct_count',r.correct_count,'last_exam_first_try_count',r.first_try_count,
            'last_exam_evidence_count',r.evidence_count,'mastery_engine','primary-concept-running-evidence-v1'
          )
      where workspace_id=p_workspace_id and learner_id=v_attempt.learner_id and concept_id=r.concept_id;
    else
      v_new_score:=round((r.correct_count*100.0)/r.evidence_count,2);
      insert into public.learner_concept_mastery(
        workspace_id,learner_id,concept_id,mastery_score,evidence_count,first_try_correct_count,
        total_question_count,total_hint_count,last_difficulty,last_assessed_at,metadata
      ) values (
        p_workspace_id,v_attempt.learner_id,r.concept_id,v_new_score,r.evidence_count,r.first_try_count,
        r.evidence_count,0,r.last_difficulty,v_assessed_at,jsonb_build_object(
          'last_evidence_mode','support_paper','last_exam_attempt_id',p_attempt_id,
          'last_exam_correct_count',r.correct_count,'last_exam_first_try_count',r.first_try_count,
          'last_exam_evidence_count',r.evidence_count,'mastery_engine','primary-concept-running-evidence-v1'
        )
      );
    end if;
    v_evidence_count:=v_evidence_count+r.evidence_count;
    v_concept_count:=v_concept_count+1;
  end loop;

  update public.quiz_attempts
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'concept_mastery_recorded',true,'concept_mastery_recorded_at',clock_timestamp(),
    'concept_mastery_engine','primary-concept-running-evidence-v1',
    'concept_mastery_evidence_count',v_evidence_count,'concept_mastery_concept_count',v_concept_count
  )
  where workspace_id=p_workspace_id and id=p_attempt_id;

  return jsonb_build_object('ok',true,'already_recorded',false,'evidence_count',v_evidence_count,'concept_count',v_concept_count);
end;
$function$;

revoke all on function public.flh_support_record_exam_concept_mastery(uuid,uuid) from public;
revoke all on function public.flh_support_record_exam_concept_mastery(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_support_record_exam_concept_mastery(uuid,uuid) to service_role;

create or replace function public.flh_support_paper_exam_submit(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_unanswered_sequence_nos integer[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempt record;
  v_validation jsonb;
  v_missing integer[]:='{}'::integer[];
  v_declared integer[]:='{}'::integer[];
  v_declared_count integer:=0;
  v_declared_distinct_count integer:=0;
  v_invalid_declared_count integer:=0;
  v_queue_count integer:=0;
  v_answer_count integer:=0;
  v_score numeric:=0;
  v_max numeric:=0;
  v_duration integer:=1;
  v_review jsonb:='[]'::jsonb;
  v_quiz jsonb:='{}'::jsonb;
  v_is_correct boolean;
  v_numeric_response numeric;
  v_numeric_correct numeric;
  v_tolerance numeric;
  v_text_response text;
  r record;
begin
  select a.quiz_version_id,a.started_at,a.metadata into v_attempt
  from public.quiz_attempts a
  where a.workspace_id=p_workspace_id and a.id=p_attempt_id and a.learner_id=p_learner_id
    and a.status='in_progress' and a.delivery_mode='exam'
  limit 1 for update;
  if not found then return jsonb_build_object('error','ATTEMPT_NOT_ACTIVE'); end if;
  if nullif(v_attempt.metadata->>'paper_model_code','') is null then return jsonb_build_object('error','PAPER_ATTEMPT_REQUIRED'); end if;
  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_QUEUE_NOT_VALIDATED');
  end if;

  v_validation:=public.flh_support_paper_validate_queue(p_workspace_id,p_attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    return jsonb_build_object('error','PAPER_QUEUE_VALIDATION_FAILED','reason',v_validation->>'error');
  end if;

  if p_unanswered_sequence_nos is null then p_unanswered_sequence_nos:='{}'::integer[]; end if;
  if array_position(p_unanswered_sequence_nos,null) is not null then
    return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID');
  end if;
  select count(*),count(distinct x),coalesce(array_agg(distinct x order by x),'{}'::integer[])
    into v_declared_count,v_declared_distinct_count,v_declared
  from unnest(p_unanswered_sequence_nos) x;
  if v_declared_count<>v_declared_distinct_count then return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID'); end if;

  select count(*) into v_invalid_declared_count
  from unnest(v_declared) x
  where not exists(select 1 from public.quiz_attempt_question_queue qq
    where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id and qq.sequence_no=x);
  if v_invalid_declared_count<>0 then return jsonb_build_object('error','PAPER_UNANSWERED_DECLARATION_INVALID'); end if;

  select coalesce(array_agg(qq.sequence_no order by qq.sequence_no),'{}'::integer[]) into v_missing
  from public.quiz_attempt_question_queue qq
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id
    and not exists(select 1 from public.quiz_attempt_answers aa
      where aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id);
  if v_declared is distinct from v_missing then
    return jsonb_build_object('error','PAPER_UNANSWERED_SET_MISMATCH',
      'declared_count',cardinality(v_declared),'missing_count',cardinality(v_missing));
  end if;

  if cardinality(v_declared)>0 then
    perform set_config('flh.paper_unanswered_attempt_id',p_attempt_id::text,true);
    insert into public.quiz_attempt_answers(
      workspace_id,attempt_id,question_id,response,evaluation,is_correct,points_awarded,
      answered_at,attempts_used,hints_used,first_try_correct,mastery_result
    )
    select qq.workspace_id,qq.quiz_attempt_id,qq.question_id,'{"unanswered":true}'::jsonb,'ungraded',
      null,null,clock_timestamp(),0,0,null,null
    from public.quiz_attempt_question_queue qq
    where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id and qq.sequence_no=any(v_declared)
      and not exists(select 1 from public.quiz_attempt_answers aa
        where aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id);
    perform set_config('flh.paper_unanswered_attempt_id','',true);
  end if;

  select count(*),count(aa.question_id) into v_queue_count,v_answer_count
  from public.quiz_attempt_question_queue qq
  left join public.quiz_attempt_answers aa
    on aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id;
  if v_queue_count=0 or v_answer_count<>v_queue_count then return jsonb_build_object('error','EXAM_NOT_COMPLETE'); end if;

  for r in
    select aa.question_id,aa.response,q.question_type,q.points,
           coalesce(q.source_metadata->>'grading_mode','graded') grading_mode,
           k.correct_answer,k.grading_config
    from public.quiz_attempt_question_queue qq
    join public.quiz_questions q on q.workspace_id=qq.workspace_id and q.id=qq.question_id
    join public.quiz_attempt_answers aa
      on aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id
    left join public.quiz_question_answer_keys k on k.workspace_id=q.workspace_id and k.question_id=q.id
    where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id
    order by qq.sequence_no
  loop
    if r.grading_mode='ungraded' then
      update public.quiz_attempt_answers
      set evaluation='ungraded',is_correct=null,points_awarded=0,first_try_correct=null,mastery_result=null
      where workspace_id=p_workspace_id and attempt_id=p_attempt_id and question_id=r.question_id;
      continue;
    end if;

    v_is_correct:=false;
    if r.response='{"unanswered":true}'::jsonb then
      v_is_correct:=false;
    elsif r.question_type='single_choice' then
      v_is_correct:=nullif(r.response->>'option_position','')::integer=
                    nullif(r.correct_answer->>'option_position','')::integer;
    elsif r.question_type='numeric' then
      v_numeric_response:=replace(btrim(r.response->>'value'),',','.')::numeric;
      v_numeric_correct:=replace(btrim(r.correct_answer->>'value'),',','.')::numeric;
      v_tolerance:=coalesce(nullif(r.grading_config->>'absolute_tolerance','')::numeric,0);
      v_is_correct:=abs(v_numeric_response-v_numeric_correct)<=greatest(v_tolerance,0);
    elsif r.question_type='short_answer' then
      v_text_response:=lower(regexp_replace(btrim(coalesce(r.response->>'value','')),'[[:space:]]+','','g'));
      if jsonb_typeof(r.correct_answer->'accepted_text')='array' then
        select exists(
          select 1 from jsonb_array_elements_text(r.correct_answer->'accepted_text') t(value)
          where lower(regexp_replace(btrim(t.value),'[[:space:]]+','','g'))=v_text_response
        ) into v_is_correct;
      else
        v_is_correct:=v_text_response=lower(regexp_replace(btrim(coalesce(r.correct_answer->>'value','')),'[[:space:]]+','','g'));
      end if;
    end if;

    update public.quiz_attempt_answers
    set evaluation=case when v_is_correct then 'correct' else 'incorrect' end,
        is_correct=v_is_correct,
        points_awarded=case when v_is_correct then coalesce(r.points,1) else 0 end,
        first_try_correct=v_is_correct,
        mastery_result=case when v_is_correct then 'mastered' else 'not_mastered' end
    where workspace_id=p_workspace_id and attempt_id=p_attempt_id and question_id=r.question_id;
  end loop;

  select coalesce(sum(coalesce(aa.points_awarded,0)),0),
         coalesce(sum(case when coalesce(q.source_metadata->>'grading_mode','graded')='ungraded' then 0 else coalesce(q.points,1) end),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'question_id',q.id,'question_code',q.question_code,'prompt',q.prompt,'response',aa.response,
           'evaluation',aa.evaluation,'is_correct',aa.is_correct,
           'correct_answer',case when coalesce(q.source_metadata->>'grading_mode','graded')='ungraded' then null else k.correct_answer end,
           'explanation',case when coalesce(q.source_metadata->>'grading_mode','graded')='ungraded' then null
             when aa.is_correct then coalesce(nullif(k.correct_explanation,''),nullif(k.explanation,''))
             else coalesce(nullif(k.final_incorrect_explanation,''),nullif(k.explanation,'')) end
         ) order by qq.sequence_no),'[]'::jsonb)
    into v_score,v_max,v_review
  from public.quiz_attempt_question_queue qq
  join public.quiz_questions q on q.workspace_id=qq.workspace_id and q.id=qq.question_id
  join public.quiz_attempt_answers aa
    on aa.workspace_id=qq.workspace_id and aa.attempt_id=qq.quiz_attempt_id and aa.question_id=qq.question_id
  left join public.quiz_question_answer_keys k on k.workspace_id=q.workspace_id and k.question_id=q.id
  where qq.workspace_id=p_workspace_id and qq.quiz_attempt_id=p_attempt_id;

  v_duration:=greatest(1,round(extract(epoch from(clock_timestamp()-v_attempt.started_at)))::integer);
  update public.quiz_attempts
  set status='submitted',submitted_at=clock_timestamp(),score_points=v_score,max_points=v_max,
      percentage=case when v_max>0 then round(v_score/v_max*100,2) else 0 end,
      duration_seconds=v_duration,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'engine','support-paper-exam-v1','server_graded',true,'question_count',v_queue_count
      )
  where workspace_id=p_workspace_id and id=p_attempt_id and status='in_progress';

  update public.quiz_attempt_question_queue set status='completed'
  where workspace_id=p_workspace_id and quiz_attempt_id=p_attempt_id;

  select jsonb_build_object('slug',q.slug,'title',q.title) into v_quiz
  from public.quiz_versions v join public.quizzes q on q.workspace_id=v.workspace_id and q.id=v.quiz_id
  where v.workspace_id=p_workspace_id and v.id=v_attempt.quiz_version_id limit 1;

  return jsonb_build_object('ok',true,'attempt_id',p_attempt_id,'quiz',coalesce(v_quiz,'{}'::jsonb),
    'score_points',v_score,'max_points',v_max,
    'percentage',case when v_max>0 then round(v_score/v_max*100,2) else 0 end,
    'review',v_review);
end;
$function$;

revoke all on function public.flh_support_paper_exam_submit(uuid,uuid,uuid,integer[]) from public;
revoke all on function public.flh_support_paper_exam_submit(uuid,uuid,uuid,integer[]) from anon,authenticated;
grant execute on function public.flh_support_paper_exam_submit(uuid,uuid,uuid,integer[]) to service_role;



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
begin
  if exists(
    select 1 from public.quiz_versions
    where workspace_id=p_workspace_id and id=p_quiz_version_id and state='published'
      and coalesce((settings->>'support_source')::boolean,false)
  ) then
    return public.flh_support_paper_runtime_package(p_workspace_id,p_quiz_version_id);
  end if;
  return public.flh_paper_exam_runtime_package_legacy_flh020(p_workspace_id,p_quiz_version_id);
end;
$function$;

revoke all on function public.flh_paper_exam_runtime_package(uuid,uuid) from public;
revoke all on function public.flh_paper_exam_runtime_package(uuid,uuid) from anon,authenticated;
grant execute on function public.flh_paper_exam_runtime_package(uuid,uuid) to service_role;

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
  v_version uuid;
begin
  select quiz_version_id into v_version
  from public.quiz_attempts
  where workspace_id=p_workspace_id and id=p_attempt_id
  limit 1;
  if v_version is not null and exists(
    select 1 from public.quiz_versions
    where workspace_id=p_workspace_id and id=v_version
      and coalesce((settings->>'support_source')::boolean,false)
  ) then
    return public.flh_support_paper_validate_queue(p_workspace_id,p_attempt_id);
  end if;
  return public.flh_paper_exam_validate_queue_legacy_flh020(p_workspace_id,p_attempt_id);
end;
$function$;

revoke all on function public.flh_paper_exam_validate_queue(uuid,uuid) from public;
revoke all on function public.flh_paper_exam_validate_queue(uuid,uuid) from anon,authenticated;
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
begin
  if exists(
    select 1 from public.quiz_versions
    where workspace_id=p_workspace_id and id=p_quiz_version_id and state='published'
      and coalesce((settings->>'support_source')::boolean,false)
  ) then
    return public.flh_support_paper_start(p_workspace_id,p_learner_id,p_quiz_version_id,p_paper_model_code,p_source);
  end if;
  return public.flh_paper_exam_start_legacy_flh020(p_workspace_id,p_learner_id,p_quiz_version_id,p_paper_model_code,p_source);
end;
$function$;

revoke all on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) from public;
revoke all on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) from anon,authenticated;
grant execute on function public.flh_paper_exam_start(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.flh_paper_exam_submit(
  p_workspace_id uuid,
  p_learner_id uuid,
  p_attempt_id uuid,
  p_unanswered_sequence_nos integer[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_version uuid;
begin
  select quiz_version_id into v_version
  from public.quiz_attempts
  where workspace_id=p_workspace_id and id=p_attempt_id and learner_id=p_learner_id
  limit 1;
  if v_version is not null and exists(
    select 1 from public.quiz_versions
    where workspace_id=p_workspace_id and id=v_version
      and coalesce((settings->>'support_source')::boolean,false)
  ) then
    return public.flh_support_paper_exam_submit(p_workspace_id,p_learner_id,p_attempt_id,p_unanswered_sequence_nos);
  end if;
  return public.flh_paper_exam_submit_legacy_flh020(p_workspace_id,p_learner_id,p_attempt_id,p_unanswered_sequence_nos);
end;
$function$;

revoke all on function public.flh_paper_exam_submit(uuid,uuid,uuid,integer[]) from public;
revoke all on function public.flh_paper_exam_submit(uuid,uuid,uuid,integer[]) from anon,authenticated;
grant execute on function public.flh_paper_exam_submit(uuid,uuid,uuid,integer[]) to service_role;


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
  v_support boolean:=false;
  v_question_type text;
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

  if coalesce((v_attempt.metadata->>'paper_queue_validated')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_NOT_VALIDATED';
  end if;

  v_validation:=public.flh_paper_exam_validate_queue(new.workspace_id,new.attempt_id);
  if coalesce((v_validation->>'ok')::boolean,false) is not true then
    raise exception 'PAPER_QUEUE_VALIDATION_FAILED:%',coalesce(v_validation->>'error','UNKNOWN');
  end if;

  select settings->'paper_exam',
         coalesce((settings->>'support_source')::boolean,false)
    into v_paper,v_support
  from public.quiz_versions
  where workspace_id=new.workspace_id
    and id=v_attempt.quiz_version_id
    and state='published';

  select value into v_entry
  from jsonb_each(v_paper->'paper_question_map')
  where value->>'question_id'=new.question_id::text
  limit 1;
  if v_entry is null then raise exception 'PAPER_QUESTION_NOT_MAPPED'; end if;

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

  if new.response ? 'unanswered' then raise exception 'PAPER_ANSWER_INVALID'; end if;

  if v_support then
    select q.question_type into v_question_type
    from public.quiz_questions q
    where q.workspace_id=new.workspace_id
      and q.id=new.question_id
      and q.quiz_version_id=v_attempt.quiz_version_id
    limit 1;
    if not found or v_question_type not in ('single_choice','numeric','short_answer') then
      raise exception 'PAPER_ANSWER_INVALID';
    end if;

    if v_question_type='single_choice' then
      if jsonb_typeof(new.response)<>'object'
         or jsonb_object_length(new.response)<>1
         or not(new.response?'option_position') then
        raise exception 'PAPER_ANSWER_INVALID';
      end if;
      begin
        v_option_position:=nullif(new.response->>'option_position','')::integer;
      exception when others then
        raise exception 'PAPER_ANSWER_INVALID';
      end;
      if v_option_position is null or not exists (
        select 1
        from jsonb_each_text(coalesce(v_entry->'option_positions','{}'::jsonb)) p
        where p.value ~ '^[1-9][0-9]*$'
          and p.value::integer=v_option_position
      ) then
        raise exception 'PAPER_OPTION_NOT_MAPPED';
      end if;
      return new;
    end if;

    if jsonb_typeof(new.response)<>'object'
       or jsonb_object_length(new.response)<>1
       or not(new.response?'value')
       or jsonb_typeof(new.response->'value')<>'string' then
      raise exception 'PAPER_ANSWER_INVALID';
    end if;
    v_value:=new.response->>'value';
    if nullif(btrim(v_value),'') is null or char_length(v_value)>2000 then
      raise exception 'PAPER_ANSWER_INVALID';
    end if;
    if v_question_type='numeric' then
      begin
        perform replace(btrim(v_value),',','.')::numeric;
      exception when others then
        raise exception 'PAPER_ANSWER_INVALID';
      end;
    end if;
    return new;
  end if;

  begin
    v_option_position:=nullif(new.response->>'option_position','')::integer;
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
revoke all on function public.flh_guard_paper_attempt_answer() from anon,authenticated;

create or replace function public.flh_record_exam_mastery_on_submit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_support boolean:=false;
begin
  if new.delivery_mode='exam' and new.status='submitted' and old.status is distinct from new.status then
    select coalesce((settings->>'support_source')::boolean,false) into v_support
    from public.quiz_versions
    where workspace_id=new.workspace_id and id=new.quiz_version_id
    limit 1;
    if v_support then
      v_result:=public.flh_support_record_exam_concept_mastery(new.workspace_id,new.id);
    else
      v_result:=public.flh_record_exam_concept_mastery(new.workspace_id,new.id);
    end if;
    if coalesce((v_result->>'ok')::boolean,false) is not true then
      raise exception 'EXAM_MASTERY_RECORD_FAILED:%',coalesce(v_result->>'error','UNKNOWN');
    end if;
  end if;
  return null;
end;
$function$;

revoke all on function public.flh_record_exam_mastery_on_submit() from public;
revoke all on function public.flh_record_exam_mastery_on_submit() from anon,authenticated;
grant execute on function public.flh_record_exam_mastery_on_submit() to service_role;
