-- FLH-FEAT-2026-006 v1.0
-- SPEC_REVISION_ID: ANLCKQklYVbefbCW6URP9IKRimcZ-hAqhqsNqnHJYMJpXhBY71H5l3LICz1imueDFNY2oyGwc2zifPZ_iib-e0Ck4LQoHzYD202eA_oVnKw
-- MIGRATION_IDENTITY: 20260926202000_normalize_learner_independent_catalog.sql
-- Forward-only normalization of learner-independent catalog/configuration rows.
-- Historical published quiz versions and historical migrations remain immutable.

do $migration$
declare
  v_workspace uuid;
  v_quiz record;
  v_source_version public.quiz_versions%rowtype;
  v_new_version uuid;
  v_new_version_no integer;
  v_old_question public.quiz_questions%rowtype;
  v_new_question uuid;
  v_instruction text;
  v_question_code text;
  v_question_count integer;
begin
  select id
    into v_workspace
  from public.workspaces
  where slug = 'family-learning-hub'
  limit 1;

  if v_workspace is null then
    raise exception 'FAMILY_LEARNING_WORKSPACE_NOT_FOUND';
  end if;

  update public.books
  set source_metadata = coalesce(source_metadata, '{}'::jsonb) - 'assigned_student'
  where code = 'AR-MATH-G7-2025-2026';

  update public.learning_programs
  set description = 'مسار الصف السابع للعام الدراسي 2026–2027. المصدر المتاح حاليًا هو كتاب الرياضيات ذو غلاف 2025–2026، ويُستخدم مع إظهار حالة التحقق من إصدار 2026–2027.',
      metadata = coalesce(metadata, '{}'::jsonb) - 'learner'
  where workspace_id = v_workspace
    and slug = 'syrian-g7-2026-2027';

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
    -- A prior successful run already created the normalized immutable successor.
    if exists (
      select 1
      from public.quiz_versions
      where workspace_id = v_workspace
        and quiz_id = v_quiz.id
        and settings->'catalog_normalization'->>'feature_id' = 'FLH-FEAT-2026-006'
    ) then
      continue;
    end if;

    select *
      into v_source_version
    from public.quiz_versions
    where workspace_id = v_workspace
      and quiz_id = v_quiz.id
      and version_no = 1
    limit 1;

    if v_source_version.id is null or v_source_version.state <> 'published' then
      raise exception 'CATALOG_NORMALIZATION_SOURCE_VERSION_MISSING_OR_NOT_PUBLISHED: %', v_quiz.slug;
    end if;

    select count(*)
      into v_question_count
    from public.quiz_questions
    where workspace_id = v_workspace
      and quiz_version_id = v_source_version.id;

    if v_question_count <> 13 then
      raise exception 'CATALOG_NORMALIZATION_EXPECTED_13_QUESTIONS: %, found %', v_quiz.slug, v_question_count;
    end if;

    select coalesce(max(version_no), 0) + 1
      into v_new_version_no
    from public.quiz_versions
    where workspace_id = v_workspace
      and quiz_id = v_quiz.id;

    v_instruction := case v_quiz.slug
      when 'sy-g7-integers-add-subtract-v1' then
        'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026». في وضع التعلّم استخدم التلميحات وتعلّم من الخطأ. بعد الانتهاء افتح Exam Mode؛ لن يظهر لك التصحيح أثناء الامتحان، وستظهر النتيجة بعد التسليم.'
      when 'sy-g7-integers-multiply-divide-v1' then
        'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026». تعلّم قاعدة الإشارات من كل سؤال، وبعدها افتح Exam Mode. في الامتحان لا توجد تلميحات ولا يظهر التصحيح قبل التسليم.'
    end;

    insert into public.quiz_versions(
      workspace_id,
      quiz_id,
      version_no,
      state,
      instructions,
      settings,
      published_at,
      created_by,
      question_language,
      explanation_language,
      terminology_display_mode
    )
    values (
      v_workspace,
      v_quiz.id,
      v_new_version_no,
      'draft',
      v_instruction,
      coalesce(v_source_version.settings, '{}'::jsonb) || jsonb_build_object(
        'catalog_normalization',
        jsonb_build_object(
          'feature_id', 'FLH-FEAT-2026-006',
          'source_version_id', v_source_version.id,
          'source_version_no', v_source_version.version_no
        )
      ),
      null,
      v_source_version.created_by,
      v_source_version.question_language,
      v_source_version.explanation_language,
      v_source_version.terminology_display_mode
    )
    returning id into v_new_version;

    for v_old_question in
      select *
      from public.quiz_questions
      where workspace_id = v_workspace
        and quiz_version_id = v_source_version.id
      order by position
    loop
      v_new_question := gen_random_uuid();
      v_question_code := case v_quiz.slug
        when 'sy-g7-integers-add-subtract-v1'
          then 'Q-' || (20260926000 + v_old_question.position)::text
        when 'sy-g7-integers-multiply-divide-v1'
          then 'Q-' || (20260926013 + v_old_question.position)::text
      end;

      if exists (
        select 1
        from public.quiz_questions
        where question_code = v_question_code
      ) then
        raise exception 'CATALOG_NORMALIZATION_QUESTION_CODE_COLLISION: %', v_question_code;
      end if;

      insert into public.quiz_questions(
        id,
        workspace_id,
        quiz_version_id,
        position,
        question_type,
        prompt,
        origin,
        source_page_start,
        source_page_end,
        source_metadata,
        points,
        question_family_id,
        difficulty_level,
        max_attempts,
        remediation_after_attempt,
        adaptive_enabled,
        delivery_role,
        prompt_language,
        terminology_display_mode,
        question_code
      )
      values (
        v_new_question,
        v_workspace,
        v_new_version,
        v_old_question.position,
        v_old_question.question_type,
        v_old_question.prompt,
        v_old_question.origin,
        v_old_question.source_page_start,
        v_old_question.source_page_end,
        v_old_question.source_metadata,
        v_old_question.points,
        v_old_question.question_family_id,
        v_old_question.difficulty_level,
        v_old_question.max_attempts,
        v_old_question.remediation_after_attempt,
        v_old_question.adaptive_enabled,
        v_old_question.delivery_role,
        v_old_question.prompt_language,
        v_old_question.terminology_display_mode,
        v_question_code
      );

      insert into public.quiz_question_options(
        workspace_id, question_id, position, label, content
      )
      select
        workspace_id, v_new_question, position, label, content
      from public.quiz_question_options
      where workspace_id = v_workspace
        and question_id = v_old_question.id
      order by position;

      insert into public.quiz_question_answer_keys(
        question_id,
        workspace_id,
        correct_answer,
        explanation,
        grading_config,
        correct_explanation,
        final_incorrect_explanation
      )
      select
        v_new_question,
        workspace_id,
        correct_answer,
        explanation,
        grading_config,
        correct_explanation,
        final_incorrect_explanation
      from public.quiz_question_answer_keys
      where workspace_id = v_workspace
        and question_id = v_old_question.id;

      insert into public.quiz_question_hints(
        workspace_id,
        question_id,
        hint_level,
        pedagogical_role,
        content,
        metadata,
        language,
        terminology_display_mode
      )
      select
        workspace_id,
        v_new_question,
        hint_level,
        pedagogical_role,
        content,
        metadata,
        language,
        terminology_display_mode
      from public.quiz_question_hints
      where workspace_id = v_workspace
        and question_id = v_old_question.id
      order by hint_level;

      insert into public.quiz_question_concepts(
        workspace_id,
        question_id,
        concept_id,
        is_primary,
        weight
      )
      select
        workspace_id,
        v_new_question,
        concept_id,
        is_primary,
        weight
      from public.quiz_question_concepts
      where workspace_id = v_workspace
        and question_id = v_old_question.id;
    end loop;

    -- Publish only after the complete question graph exists. Version 1 remains
    -- untouched for historical attempts and immutable publication history.
    update public.quiz_versions
    set state = 'published',
        published_at = now(),
        updated_at = now()
    where workspace_id = v_workspace
      and id = v_new_version;
  end loop;
end
$migration$;
