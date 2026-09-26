do $contract$
declare
  v_workspace uuid;
  v_program uuid;
  v_quiz record;
  v_old_version public.quiz_versions%rowtype;
  v_new_version public.quiz_versions%rowtype;
  v_expected_instruction text;
  v_old_payload jsonb;
  v_new_payload jsonb;
begin
  select id
    into v_workspace
  from public.workspaces
  where slug = 'family-learning-hub'
  limit 1;

  if v_workspace is null then
    raise exception 'catalog normalization contract: workspace missing';
  end if;

  if not exists (
    select 1
    from public.books
    where code = 'AR-MATH-G7-2025-2026'
  ) then
    raise exception 'catalog normalization contract: target book missing';
  end if;

  if exists (
    select 1
    from public.books
    where code = 'AR-MATH-G7-2025-2026'
      and (
        coalesce(source_metadata, '{}'::jsonb) ? 'assigned_student'
        or lower(coalesce(source_metadata, '{}'::jsonb)::text) like '%mohammad%'
      )
  ) then
    raise exception 'catalog normalization contract: generic book metadata still contains learner identity';
  end if;

  select id
    into v_program
  from public.learning_programs
  where workspace_id = v_workspace
    and slug = 'syrian-g7-2026-2027'
  limit 1;

  if v_program is null then
    raise exception 'catalog normalization contract: target program missing';
  end if;

  if exists (
    select 1
    from public.learning_programs
    where id = v_program
      and (
        coalesce(metadata, '{}'::jsonb) ? 'learner'
        or lower(coalesce(title, '')) like '%mohammad%'
        or lower(coalesce(description, '')) like '%mohammad%'
        or lower(coalesce(metadata, '{}'::jsonb)::text) like '%mohammad%'
      )
  ) then
    raise exception 'catalog normalization contract: generic program still contains learner identity';
  end if;

  for v_quiz in
    select id, slug
    from public.quizzes
    where workspace_id = v_workspace
      and slug in (
        'sy-g7-integers-add-subtract-v1',
        'sy-g7-integers-multiply-divide-v1'
      )
    order by slug
  loop
    select *
      into v_old_version
    from public.quiz_versions
    where workspace_id = v_workspace
      and quiz_id = v_quiz.id
      and version_no = 1
    limit 1;

    select *
      into v_new_version
    from public.quiz_versions
    where workspace_id = v_workspace
      and quiz_id = v_quiz.id
      and settings->'catalog_normalization'->>'feature_id' = 'FLH-FEAT-2026-006'
    order by version_no desc
    limit 1;

    if v_old_version.id is null or v_old_version.state <> 'published' then
      raise exception 'catalog normalization contract: historical published version 1 missing for %', v_quiz.slug;
    end if;

    -- Historical publication remains immutable; it may retain the historical
    -- learner label because existing attempts/results are bound to this version.
    if v_old_version.instructions not like 'محمد:%' then
      raise exception 'catalog normalization contract: historical version 1 was unexpectedly rewritten for %', v_quiz.slug;
    end if;

    if v_new_version.id is null
       or v_new_version.state <> 'published'
       or v_new_version.version_no <= 1 then
      raise exception 'catalog normalization contract: normalized published successor missing for %', v_quiz.slug;
    end if;

    v_expected_instruction := case v_quiz.slug
      when 'sy-g7-integers-add-subtract-v1' then
        'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026». في وضع التعلّم استخدم التلميحات وتعلّم من الخطأ. بعد الانتهاء افتح Exam Mode؛ لن يظهر لك التصحيح أثناء الامتحان، وستظهر النتيجة بعد التسليم.'
      when 'sy-g7-integers-multiply-divide-v1' then
        'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026». تعلّم قاعدة الإشارات من كل سؤال، وبعدها افتح Exam Mode. في الامتحان لا توجد تلميحات ولا يظهر التصحيح قبل التسليم.'
    end;

    if nullif(v_new_version.instructions, '') is null
       or v_new_version.instructions <> v_expected_instruction then
      raise exception 'catalog normalization contract: normalized instructions are not exact for %', v_quiz.slug;
    end if;

    if lower(v_new_version.instructions) like '%mohammad%'
       or v_new_version.instructions like '%محمد%' then
      raise exception 'catalog normalization contract: normalized instructions contain learner identity for %', v_quiz.slug;
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'position', q.position,
        'question_type', q.question_type,
        'prompt', q.prompt,
        'origin', q.origin,
        'source_page_start', q.source_page_start,
        'source_page_end', q.source_page_end,
        'source_metadata', q.source_metadata,
        'points', q.points,
        'question_family_id', q.question_family_id,
        'difficulty_level', q.difficulty_level,
        'max_attempts', q.max_attempts,
        'remediation_after_attempt', q.remediation_after_attempt,
        'adaptive_enabled', q.adaptive_enabled,
        'delivery_role', q.delivery_role,
        'prompt_language', q.prompt_language,
        'terminology_display_mode', q.terminology_display_mode,
        'options', (
          select jsonb_agg(
            jsonb_build_object(
              'position', o.position,
              'label', o.label,
              'content', o.content
            )
            order by o.position
          )
          from public.quiz_question_options o
          where o.workspace_id = q.workspace_id
            and o.question_id = q.id
        ),
        'answer_key', (
          select jsonb_build_object(
            'correct_answer', a.correct_answer,
            'explanation', a.explanation,
            'grading_config', a.grading_config,
            'correct_explanation', a.correct_explanation,
            'final_incorrect_explanation', a.final_incorrect_explanation
          )
          from public.quiz_question_answer_keys a
          where a.workspace_id = q.workspace_id
            and a.question_id = q.id
        ),
        'hints', (
          select jsonb_agg(
            jsonb_build_object(
              'hint_level', h.hint_level,
              'pedagogical_role', h.pedagogical_role,
              'content', h.content,
              'metadata', h.metadata,
              'language', h.language,
              'terminology_display_mode', h.terminology_display_mode
            )
            order by h.hint_level
          )
          from public.quiz_question_hints h
          where h.workspace_id = q.workspace_id
            and h.question_id = q.id
        ),
        'concepts', (
          select jsonb_agg(
            jsonb_build_object(
              'concept_id', c.concept_id,
              'is_primary', c.is_primary,
              'weight', c.weight
            )
            order by c.concept_id
          )
          from public.quiz_question_concepts c
          where c.workspace_id = q.workspace_id
            and c.question_id = q.id
        )
      )
      order by q.position
    )
      into v_old_payload
    from public.quiz_questions q
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_old_version.id;

    select jsonb_agg(
      jsonb_build_object(
        'position', q.position,
        'question_type', q.question_type,
        'prompt', q.prompt,
        'origin', q.origin,
        'source_page_start', q.source_page_start,
        'source_page_end', q.source_page_end,
        'source_metadata', q.source_metadata,
        'points', q.points,
        'question_family_id', q.question_family_id,
        'difficulty_level', q.difficulty_level,
        'max_attempts', q.max_attempts,
        'remediation_after_attempt', q.remediation_after_attempt,
        'adaptive_enabled', q.adaptive_enabled,
        'delivery_role', q.delivery_role,
        'prompt_language', q.prompt_language,
        'terminology_display_mode', q.terminology_display_mode,
        'options', (
          select jsonb_agg(
            jsonb_build_object(
              'position', o.position,
              'label', o.label,
              'content', o.content
            )
            order by o.position
          )
          from public.quiz_question_options o
          where o.workspace_id = q.workspace_id
            and o.question_id = q.id
        ),
        'answer_key', (
          select jsonb_build_object(
            'correct_answer', a.correct_answer,
            'explanation', a.explanation,
            'grading_config', a.grading_config,
            'correct_explanation', a.correct_explanation,
            'final_incorrect_explanation', a.final_incorrect_explanation
          )
          from public.quiz_question_answer_keys a
          where a.workspace_id = q.workspace_id
            and a.question_id = q.id
        ),
        'hints', (
          select jsonb_agg(
            jsonb_build_object(
              'hint_level', h.hint_level,
              'pedagogical_role', h.pedagogical_role,
              'content', h.content,
              'metadata', h.metadata,
              'language', h.language,
              'terminology_display_mode', h.terminology_display_mode
            )
            order by h.hint_level
          )
          from public.quiz_question_hints h
          where h.workspace_id = q.workspace_id
            and h.question_id = q.id
        ),
        'concepts', (
          select jsonb_agg(
            jsonb_build_object(
              'concept_id', c.concept_id,
              'is_primary', c.is_primary,
              'weight', c.weight
            )
            order by c.concept_id
          )
          from public.quiz_question_concepts c
          where c.workspace_id = q.workspace_id
            and c.question_id = q.id
        )
      )
      order by q.position
    )
      into v_new_payload
    from public.quiz_questions q
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version.id;

    if jsonb_array_length(coalesce(v_old_payload, '[]'::jsonb)) <> 13
       or v_old_payload is distinct from v_new_payload then
      raise exception 'catalog normalization contract: cloned academic content differs for %', v_quiz.slug;
    end if;
  end loop;
end
$contract$;
