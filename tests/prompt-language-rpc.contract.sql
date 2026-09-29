-- FLH-FEAT-2026-008 v1.0
-- Runtime response contract: learner-facing prompt payloads must preserve language metadata.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.flh_exam_start(uuid,uuid,text)'::regprocedure);
  if position('''prompt_language'', q.prompt_language' in v_def) = 0 then
    raise exception 'EXAM_START_PROMPT_LANGUAGE_MISSING';
  end if;

  v_def := pg_get_functiondef('public.flh_exam_submit(uuid,uuid,uuid)'::regprocedure);
  if position('''prompt_language'', q.prompt_language' in v_def) = 0 then
    raise exception 'EXAM_SUBMIT_PROMPT_LANGUAGE_MISSING';
  end if;

  v_def := pg_get_functiondef('public.flh_learning_start(uuid,uuid,text)'::regprocedure);
  if position('''prompt_language'', q.prompt_language' in v_def) = 0 then
    raise exception 'LEARNING_START_PROMPT_LANGUAGE_MISSING';
  end if;

  v_def := pg_get_functiondef('public.flh_learning_finish(uuid,uuid,uuid,integer)'::regprocedure);
  if position('''prompt_language'', q.prompt_language' in v_def) = 0 then
    raise exception 'LEARNING_FINISH_PROMPT_LANGUAGE_MISSING';
  end if;

  v_def := pg_get_functiondef('public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)'::regprocedure);
  if position('''prompt_language'', v_remediation_question.prompt_language' in v_def) = 0 then
    raise exception 'LEARNING_REMEDIATION_PROMPT_LANGUAGE_MISSING';
  end if;
end
$$;
