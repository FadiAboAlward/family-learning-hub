-- FLH-FEAT-2026-015 v1.0
-- SPEC_REVISION_ID: AHj4eMQGgodji2MuZxXfhBIzjBalBr1JjXRf-O0tR6aaU9WPAckjDBS71nmJ2TXamBMe_ktHFrTNdoUQ0IRIrObMTLEeBEZ7125yAKP7ZBM
-- Forward-only remediation for progressive child-readable Learning hints.
-- Historical quiz versions and attempts remain immutable.

do $migration$
declare
  v_workspace uuid;
  v_foundations_quiz public.quizzes%rowtype;
  v_quiz public.quizzes%rowtype;
  v_source_version public.quiz_versions%rowtype;
  v_new_version uuid;
  v_new_version_no integer;
  v_old_question public.quiz_questions%rowtype;
  v_new_question uuid;
  v_source_count integer;
  v_new_count integer;
begin
  select id
    into v_workspace
  from public.workspaces
  where slug = 'family-learning-hub'
  limit 1;

  if v_workspace is null then
    raise exception 'FLH_FEAT_2026_015_WORKSPACE_NOT_FOUND';
  end if;

  -- The older foundations package is retained as historical evidence but is no
  -- longer offered for new starts. Its published versions/attempts are untouched.
  select *
    into v_foundations_quiz
  from public.quizzes
  where workspace_id = v_workspace
    and slug = 'sy-g7-arabic-u1-foundations-20260923-a'
  limit 1;

  if not found then
    raise exception 'FLH_FEAT_2026_015_FOUNDATIONS_QUIZ_NOT_FOUND';
  end if;

  update public.quizzes
  set status = 'archived',
      updated_at = now()
  where workspace_id = v_workspace
    and id = v_foundations_quiz.id
    and status <> 'archived';

  select *
    into v_quiz
  from public.quizzes
  where workspace_id = v_workspace
    and slug = 'sy-g7-arabic-u1-baseline-20261001'
  limit 1;

  if not found then
    raise exception 'FLH_FEAT_2026_015_BASELINE_QUIZ_NOT_FOUND';
  end if;

  -- Idempotent reruns never create a second FLH-FEAT-2026-015 successor.
  if exists (
    select 1
    from public.quiz_versions
    where workspace_id = v_workspace
      and quiz_id = v_quiz.id
      and settings->'progressive_hint_readability'->>'feature_id' = 'FLH-FEAT-2026-015'
  ) then
    return;
  end if;

  select *
    into v_source_version
  from public.quiz_versions
  where workspace_id = v_workspace
    and quiz_id = v_quiz.id
    and state = 'published'
  order by version_no desc
  limit 1;

  if not found then
    raise exception 'FLH_FEAT_2026_015_PUBLISHED_SOURCE_VERSION_NOT_FOUND';
  end if;

  select count(*)
    into v_source_count
  from public.quiz_questions
  where workspace_id = v_workspace
    and quiz_version_id = v_source_version.id;

  if v_source_count <> 40 then
    raise exception 'FLH_FEAT_2026_015_SOURCE_QUESTION_COUNT_INVALID:%', v_source_count;
  end if;

  if (
    select count(*)
    from public.quiz_questions
    where workspace_id = v_workspace
      and quiz_version_id = v_source_version.id
      and delivery_role = 'core'
  ) <> 20 then
    raise exception 'FLH_FEAT_2026_015_SOURCE_LEARNING_COUNT_INVALID';
  end if;

  if exists (
    select 1
    from public.quiz_questions q
    left join public.quiz_question_hints h
      on h.workspace_id = q.workspace_id
     and h.question_id = q.id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_source_version.id
      and q.delivery_role = 'core'
    group by q.id
    having count(h.question_id) <> 4
       or min(h.hint_level) <> 1
       or max(h.hint_level) <> 4
       or count(distinct h.hint_level) <> 4
  ) then
    raise exception 'FLH_FEAT_2026_015_SOURCE_FOUR_HINT_LEVELS_REQUIRED';
  end if;

  if exists (
    select 1
    from public.quiz_questions q
    join public.quiz_question_hints h
      on h.workspace_id = q.workspace_id
     and h.question_id = q.id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_source_version.id
      and q.delivery_role <> 'core'
  ) then
    raise exception 'FLH_FEAT_2026_015_SOURCE_NON_LEARNING_HINTS_FORBIDDEN';
  end if;

  select coalesce(max(version_no), 0) + 1
    into v_new_version_no
  from public.quiz_versions
  where workspace_id = v_workspace
    and quiz_id = v_quiz.id;

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
    v_source_version.instructions,
    coalesce(v_source_version.settings, '{}'::jsonb) || jsonb_build_object(
      'progressive_hint_readability',
      jsonb_build_object(
        'feature_id', 'FLH-FEAT-2026-015',
        'spec_version', '1.0',
        'source_version_id', v_source_version.id,
        'source_version_no', v_source_version.version_no,
        'minimum_hint_words', 30,
        'learner_visible_bullets', 3
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
      terminology_display_mode
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
      coalesce(v_old_question.source_metadata, '{}'::jsonb) || jsonb_build_object(
        'hint_readability_feature', 'FLH-FEAT-2026-015',
        'hint_readability_from_question_code', v_old_question.question_code
      ),
      v_old_question.points,
      v_old_question.question_family_id,
      v_old_question.difficulty_level,
      v_old_question.max_attempts,
      v_old_question.remediation_after_attempt,
      v_old_question.adaptive_enabled,
      v_old_question.delivery_role,
      v_old_question.prompt_language,
      v_old_question.terminology_display_mode
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
      hint.workspace_id,
      v_new_question,
      hint.hint_level,
      hint.pedagogical_role,
      case hint.hint_level
        when 1 then
          '• ابدأ بهدوء واقرأ السؤال مرة ثانية، وحدد الكلمة أو الفكرة التي يطلب منك السؤال التفكير فيها قبل أن تنظر إلى الخيارات.' || E'\n' ||
          '• ركّز على هذه الإشارة المحددة داخل السؤال والتلميح الحالي: ' || hint.learner_content || E'\n' ||
          '• لا تختَر مباشرة؛ قارِن الخيارات كلًّا على حدة، واستبعد ما لا ينسجم مع هذه الإشارة، ثم أعد قراءة السؤال قبل أن تقرر.'
        when 2 then
          '• استعمل القاعدة أو الفكرة المرتبطة بالسؤال، وحدد أولًا ما الذي يجب ملاحظته في المعطى بدل التخمين من شكل الخيارات.' || E'\n' ||
          '• طبّق هذه الاستراتيجية على السؤال نفسه: ' || hint.learner_content || E'\n' ||
          '• بعد ذلك قارِن كل خيار بالقاعدة، واستبعد ما يخالفها، واحتفظ باختيارك النهائي إلى أن تتأكد أن جميع أجزاء السؤال متوافقة معه.'
        when 3 then
          '• نفّذ الآن خطوة واضحة من الحل، واكتب أو قل لنفسك النتيجة الجزئية التي وصلت إليها قبل أن تقارنها بالخيارات.' || E'\n' ||
          '• استخدم هذه المعلومة الأقوى للمساعدة: ' || hint.learner_content || E'\n' ||
          '• إذا بقي أكثر من خيار، اختبر كل واحد بالطريقة نفسها، ولا تنتقل للجواب النهائي إلا بعد أن ترى أي خيار ينسجم مع جميع المعطيات.'
        when 4 then
          '• اتبع المسار الكامل للسؤال على مراحل واضحة، وابدأ من القاعدة أو العلاقة التي ثبتت معك في التلميحات السابقة بدل تجربة الخيارات عشوائيًا.' || E'\n' ||
          '• طبّق الآن هذه الإشارة الأقرب للحل: ' || hint.learner_content || E'\n' ||
          '• بقيت لك خطوة واحدة: حدّد بنفسك الخيار الذي يطابق النتيجة التي وصلت إليها، ثم أعد قراءة السؤال للتأكد قبل الضغط على «تأكيد الإجابة».'
        else hint.learner_content
      end,
      coalesce(hint.metadata, '{}'::jsonb) || jsonb_build_object(
        'hint_readability_feature', 'FLH-FEAT-2026-015',
        'minimum_words', 30,
        'bullet_count', 3
      ),
      hint.language,
      hint.terminology_display_mode
    from (
      select
        h.*,
        case h.content
          when 'استبعد ما يدعو إلى الانفراد أو يلغي اختلاف الأدوار، واختر المعنى الذي يجمع بين مساهمة الفرد واكتمال عمل الجماعة.'
            then 'استبعد معنى الانفراد أو إلغاء الأدوار، وابحث عن معنى يجمع مساهمة الفرد مع اكتمال عمل الجماعة.'
          when 'بعد ترتيب حروف الميزان «ف ع ل»، حدّد الاسم المقابل للحرف الواقع بين الأول والثالث، ثم اختره من البدائل.'
            then 'في الميزان «ف ع ل»، حدّد اسم الحرف الواقع بين الأول والثالث، ثم قارنه بالبدائل.'
          when 'لا يكفي عدد الحروف أو معنى الفعل للكشف عن الأصل؛ حوّل الفعل إلى صيغة صرفية قريبة تُظهر حرف العلة الأصلي نفسه بوضوح.'
            then 'عدد الحروف والمعنى لا يكشفان الأصل؛ حوّل الفعل إلى صيغة صرفية تُظهر حرف العلة الأصلي.'
          when 'اختر الدليل الصرفي الذي يحوّل الفعل إلى صيغة أخرى فتظهر فيها الواو أو الياء الأصلية بوضوح، لا مجرد معلومة عن المعنى أو عدد الحروف.'
            then 'غيّر صيغة الفعل حتى يظهر حرف العلة الأصلي، ثم استبعد الأدلة التي تتحدث عن المعنى أو عدد الحروف.'
          when 'بما أن الكلمة أكثر من ثلاثة أحرف والحرف السابق للألف الأخيرة هو الياء، فابحث عن الرسم الذي تطبَّق فيه قاعدة ما بعد الياء في غير الثلاثي.'
            then 'الكلمة غير ثلاثية، وقبل ألفها الأخيرة ياء؛ ابحث عن الرسم الذي يطبق قاعدة الألف بعد الياء.'
          else h.content
        end as learner_content
      from public.quiz_question_hints h
      where h.workspace_id = v_workspace
        and h.question_id = v_old_question.id
    ) hint
    order by hint.hint_level;

    insert into public.quiz_question_assets(
      workspace_id, question_id, asset_id, position, purpose, alt_text
    )
    select
      workspace_id, v_new_question, asset_id, position, purpose, alt_text
    from public.quiz_question_assets
    where workspace_id = v_workspace
      and question_id = v_old_question.id
    order by position;

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

  select count(*)
    into v_new_count
  from public.quiz_questions
  where workspace_id = v_workspace
    and quiz_version_id = v_new_version;

  if v_new_count <> v_source_count then
    raise exception 'FLH_FEAT_2026_015_QUESTION_COUNT_MISMATCH:%:%',
      v_source_count, v_new_count;
  end if;

  if (
    select count(*)
    from public.quiz_questions
    where workspace_id = v_workspace
      and quiz_version_id = v_new_version
      and delivery_role = 'core'
  ) <> 20 then
    raise exception 'FLH_FEAT_2026_015_LEARNING_COUNT_INVALID';
  end if;

  if (
    select count(*)
    from public.quiz_questions
    where workspace_id = v_workspace
      and quiz_version_id = v_new_version
      and delivery_role = 'exam_pool'
  ) <> 20 then
    raise exception 'FLH_FEAT_2026_015_EXAM_COUNT_INVALID';
  end if;

  if (
    select count(*)
    from public.quiz_question_hints h
    join public.quiz_questions q
      on q.workspace_id = h.workspace_id
     and q.id = h.question_id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role = 'core'
  ) <> 80 then
    raise exception 'FLH_FEAT_2026_015_HINT_COUNT_INVALID';
  end if;

  if exists (
    select 1
    from public.quiz_questions q
    left join public.quiz_question_hints h
      on h.workspace_id = q.workspace_id
     and h.question_id = q.id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role = 'core'
    group by q.id
    having count(h.question_id) <> 4
       or min(h.hint_level) <> 1
       or max(h.hint_level) <> 4
       or count(distinct h.hint_level) <> 4
  ) then
    raise exception 'FLH_FEAT_2026_015_FOUR_HINT_LEVELS_INVALID';
  end if;

  if exists (
    select 1
    from public.quiz_question_hints h
    join public.quiz_questions q
      on q.workspace_id = h.workspace_id
     and q.id = h.question_id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role <> 'core'
  ) then
    raise exception 'FLH_FEAT_2026_015_EXAM_HINTS_FORBIDDEN';
  end if;

  -- Exactly three non-empty canonical bullet lines.
  if exists (
    select 1
    from public.quiz_question_hints h
    join public.quiz_questions q
      on q.workspace_id = h.workspace_id
     and q.id = h.question_id
    cross join lateral (
      select
        count(*) as line_count,
        bool_or(btrim(line) !~ '^•[[:space:]]+[^[:space:]]') as invalid_line
      from regexp_split_to_table(h.content, E'\n') line
      where btrim(line) <> ''
    ) shape
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role = 'core'
      and (shape.line_count <> 3 or shape.invalid_line)
  ) then
    raise exception 'FLH_FEAT_2026_015_HINT_BULLET_STRUCTURE_INVALID';
  end if;

  -- At least 30 whitespace-delimited lexical tokens after removing bullet marks.
  if exists (
    select 1
    from public.quiz_question_hints h
    join public.quiz_questions q
      on q.workspace_id = h.workspace_id
     and q.id = h.question_id
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role = 'core'
      and cardinality(
        regexp_split_to_array(
          btrim(replace(h.content, '•', '')),
          '[[:space:]]+'
        )
      ) < 30
  ) then
    raise exception 'FLH_FEAT_2026_015_HINT_MIN_WORDS_INVALID';
  end if;

  -- A hint must not contain the exact correct option text before finalization.
  if exists (
    select 1
    from public.quiz_questions q
    join public.quiz_question_hints h
      on h.workspace_id = q.workspace_id
     and h.question_id = q.id
    join public.quiz_question_answer_keys k
      on k.workspace_id = q.workspace_id
     and k.question_id = q.id
    join public.quiz_question_options o
      on o.workspace_id = q.workspace_id
     and o.question_id = q.id
     and o.position = nullif(k.correct_answer->>'option_position','')::integer
    where q.workspace_id = v_workspace
      and q.quiz_version_id = v_new_version
      and q.delivery_role = 'core'
      and btrim(o.content) <> ''
      and position(lower(btrim(o.content)) in lower(h.content)) > 0
  ) then
    raise exception 'FLH_FEAT_2026_015_HINT_ANSWER_LEAK';
  end if;

  update public.quiz_versions
  set state = 'published',
      published_at = now(),
      updated_at = now()
  where workspace_id = v_workspace
    and id = v_new_version;
end
$migration$;
