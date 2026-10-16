-- Exact Syrian G5 Arabic baseline content contract (isolated, reconstructed DB only).
-- Safe read-only verification. No student/parent attempts, wallets or real learner state used.
do $contract$
declare
  v_quiz uuid;
  v_version uuid;
  v_workspace uuid;
  v_program uuid;
  v_book uuid;
  v_count int;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub' limit 1;
  if v_workspace is null then raise exception 'SY_G5_WORKSPACE_MISSING'; end if;
  select q.id,q.book_id into v_quiz,v_book
  from public.quizzes q
  where q.workspace_id=v_workspace
    and q.slug='sy-g5-arabic-u1-brochure-baseline-20261015-v2'
    and q.status='active'
    and q.curriculum_id=(select id from public.curricula where code='syrian-national')
    and q.subject_id=(select id from public.subjects where code='arabic');
  if v_quiz is null then raise exception 'SY_G5_QUIZ_MISSING'; end if;
  if not exists (select 1 from public.books b where b.id=v_book
                 and b.code='AR-LUGATI-G5-T1' and b.grade_level=5)
  then raise exception 'SY_G5_WRONG_BOOK'; end if;

  select id into v_version from public.quiz_versions
  where workspace_id=v_workspace and quiz_id=v_quiz and version_no=1 and state='published';
  if v_version is null then raise exception 'SY_G5_VERSION_NOT_PUBLISHED'; end if;

  select id into v_program from public.learning_programs
    where workspace_id=v_workspace and slug='syrian-g5-2025-2026' and grade_level=5;
  if v_program is null or not exists
      (select 1 from public.program_quizzes
       where program_id=v_program and quiz_id=v_quiz and availability='available')
  then raise exception 'SY_G5_PROGRAM_NOT_LINKED'; end if;

  if (select count(*) from public.quiz_questions where quiz_version_id=v_version)<>40
  then raise exception 'SY_G5_QUESTION_COUNT'; end if;
  if (select count(*) from public.quiz_questions where quiz_version_id=v_version and delivery_role='core')<>20
  then raise exception 'SY_G5_LEARNING_COUNT'; end if;
  if (select count(*) from public.quiz_questions where quiz_version_id=v_version and delivery_role='exam_pool')<>20
  then raise exception 'SY_G5_EXAM_COUNT'; end if;

  if exists(select 1 from public.quiz_questions q where q.quiz_version_id=v_version
    and (q.question_type<>'single_choice' or q.prompt_language<>'ar'
    or q.source_page_start is null or q.source_page_end is null
    or q.source_page_start not in (7,8,9) or q.source_page_end<>q.source_page_start
    or q.question_code !~ '^Q-2026101500[0-4][0-9]$'))
  then raise exception 'SY_G5_CONTENT_METADATA'; end if;

  if exists(select 1 from public.quiz_questions q where q.quiz_version_id=v_version
      and (select count(*) from public.quiz_question_options o where o.question_id=q.id)<>4)
  then raise exception 'SY_G5_OPTION_COUNT'; end if;
  if exists(select 1 from public.quiz_questions q where q.quiz_version_id=v_version
      and (select count(*) from public.quiz_question_answer_keys k where k.question_id=q.id)<>1)
  then raise exception 'SY_G5_ANSWER_KEY_COUNT'; end if;

  if exists(select 1 from public.quiz_questions q where q.quiz_version_id=v_version
      and ((q.delivery_role='core' and (select count(*) from public.quiz_question_hints h where h.question_id=q.id)<>4)
       or (q.delivery_role='exam_pool' and exists(select 1 from public.quiz_question_hints h where h.question_id=q.id))))
  then raise exception 'SY_G5_HINT_MODE_BOUNDARY'; end if;
  if (select count(*) from public.quiz_question_hints h
      join public.quiz_questions q on q.id=h.question_id where q.quiz_version_id=v_version)<>80
  then raise exception 'SY_G5_HINT_COUNT'; end if;

  if exists(select 1 from public.quiz_questions q where q.quiz_version_id=v_version
    group by q.prompt having count(*)<>1)
  then raise exception 'SY_G5_DUPLICATE_PROMPT'; end if;

  if (select count(*) from public.quiz_questions q
      join public.quiz_question_concepts qc on qc.question_id=q.id
      join public.learning_concepts c on c.id=qc.concept_id
      where q.quiz_version_id=v_version and qc.is_primary is true and c.code='arabic-g5-u1-brochure')<>30
  then raise exception 'SY_G5_BROCHURE_ALLOCATION'; end if;
  if (select count(*) from public.quiz_questions q
      join public.quiz_question_concepts qc on qc.question_id=q.id
      join public.learning_concepts c on c.id=qc.concept_id
      where q.quiz_version_id=v_version and qc.is_primary is true and c.code='arabic-g5-u1-sentence-types')<>6
  then raise exception 'SY_G5_SENTENCE_ALLOCATION'; end if;
  if (select count(*) from public.quiz_questions q
      join public.quiz_question_concepts qc on qc.question_id=q.id
      join public.learning_concepts c on c.id=qc.concept_id
      where q.quiz_version_id=v_version and qc.is_primary is true and c.code='arabic-g5-u1-initial-hamza')<>4
  then raise exception 'SY_G5_HAMZA_ALLOCATION'; end if;

  -- Exactly one primary, curriculum-scoped concept association per question.
  if exists (select 1 from public.quiz_questions q where q.quiz_version_id=v_version
    and (select count(*) from public.quiz_question_concepts qc
      where qc.question_id=q.id and qc.is_primary is true)<>1)
  then raise exception 'SY_G5_PRIMARY_CONCEPT_COUNT'; end if;
  if exists (select 1 from public.quiz_questions q
    join public.quiz_question_concepts qc on qc.question_id=q.id and qc.is_primary
    join public.learning_concepts c on c.id=qc.concept_id
    where q.quiz_version_id=v_version
      and (c.subject_id<>(select id from public.subjects where code='arabic')
        or c.grade_level is distinct from 5
        or c.curriculum_id is distinct from (select id from public.curricula where code='syrian-national')))
  then raise exception 'SY_G5_PRIMARY_CONCEPT_WRONG_SCOPE'; end if;

  -- This content migration must not have generated synthetic academic attempts.
  if exists(select 1 from public.quiz_attempts a where a.quiz_version_id=v_version)
  then raise exception 'SY_G5_UNEXPECTED_ATTEMPT'; end if;
  raise notice 'Syrian G5 Arabic baseline content contract PASS: 40 questions, 80 hints, isolated modes.';
end;
$contract$;