-- FLH-FEAT-2026-014 v1.0
-- SPEC_REVISION_ID: ANLCKQmIisrgAXjzfvTfkcTy0hPDWyxPqJTZ2F_ShckEvvdljpNb5pto47R1mWpFTA_FKCNoJqWOufSb_daKqzuWUc3sGsdkP06oY1y3MS8
-- Forward-only remediation for learner-facing soft source references.
-- Historical published quiz versions remain immutable; future starts select the
-- corrected higher published version through the existing latest-version rule.

do $migration$
declare
  v_workspace uuid;
  v_slug text;
  v_quiz public.quizzes%rowtype;
  v_source_version public.quiz_versions%rowtype;
  v_new_version uuid;
  v_new_version_no integer;
  v_old_question public.quiz_questions%rowtype;
  v_new_question uuid;
  v_new_prompt text;
  v_source_count integer;
  v_new_count integer;
begin
  select id
    into v_workspace
  from public.workspaces
  where slug = 'family-learning-hub'
  limit 1;

  if v_workspace is null then
    raise exception 'FLH_FEAT_2026_014_WORKSPACE_NOT_FOUND';
  end if;

  foreach v_slug in array array[
    'sy-g7-arabic-u1-foundations-20260923-a',
    'sy-g7-arabic-u1-baseline-20261001'
  ] loop
    select *
      into v_quiz
    from public.quizzes
    where workspace_id = v_workspace
      and slug = v_slug
    limit 1;

    if not found then
      raise exception 'FLH_FEAT_2026_014_QUIZ_NOT_FOUND:%', v_slug;
    end if;

    -- A prior successful run already created the immutable corrected successor.
    if exists (
      select 1
      from public.quiz_versions
      where workspace_id = v_workspace
        and quiz_id = v_quiz.id
        and settings->'self_contained_wording'->>'feature_id' = 'FLH-FEAT-2026-014'
    ) then
      continue;
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
      raise exception 'FLH_FEAT_2026_014_PUBLISHED_SOURCE_VERSION_NOT_FOUND:%', v_slug;
    end if;

    select count(*)
      into v_source_count
    from public.quiz_questions
    where workspace_id = v_workspace
      and quiz_version_id = v_source_version.id;

    if v_source_count = 0 then
      raise exception 'FLH_FEAT_2026_014_SOURCE_QUESTIONS_MISSING:%', v_slug;
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
        'self_contained_wording',
        jsonb_build_object(
          'feature_id', 'FLH-FEAT-2026-014',
          'spec_version', '1.0',
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

      v_new_prompt := case v_old_question.prompt
        when 'في مفردات درس «عَلَمُ بلادي»، ما معنى كلمة «مُسبِغ»؟'
          then 'ورد في البيت: «عَلَمي يا مُسبغَ الحبِّ على الأرضِ وشاحًا». ما معنى «مُسبغ»؟'
        when 'ما معنى كلمة «زاخر» في مفردات نص «التعاون»؟'
          then 'ما معنى كلمة «زاخر»؟'
        when 'ما معنى «الرَّواح» كما ورد في مفردات درس «عَلَمُ بلادي»؟'
          then 'ما معنى «الرَّواح»؟'
        when 'المعنى المقصود من «الطِّماح» في مفردات الدرس هو:'
          then 'ما المعنى المقصود من «الطِّماح»؟'
        when 'أيُّ الكلمات الآتية تنتمي أكثر إلى مجال الإحساس كما في درس «التعاون»؟'
          then 'أيُّ الكلمات الآتية تنتمي أكثر إلى مجال الإحساس؟'
        when 'ما معنى كلمة «رغد» في مفردات نص «التعاون»؟'
          then 'ما معنى كلمة «رغد»؟'
        when 'وردت في مفردات «عَلَمُ بلادي» كلمة «العَبَق». ما معناها؟'
          then 'ما معنى كلمة «العَبَق»؟'
        when 'في مفردات «يا شام» ما معنى «الطَّيف»؟'
          then 'ما معنى «الطَّيف»؟'
        when 'ما معنى «أَمْرِعْهُ» في مفردات «عَلَمُ بلادي»؟'
          then 'ما معنى «أَمْرِعْهُ»؟'
        when 'ما معنى الفعل «خَفَقَ» كما ورد في مفردات «عَلَمُ بلادي»؟'
          then 'ما معنى الفعل «خَفَقَ»؟'
        when 'ما معنى «رَوْض» في مفردات نص «التعاون»؟'
          then 'ما معنى «رَوْض»؟'
        when 'في أسئلة الاستيعاب لنص «التعاون»، ما الفكرة العامة التي يوجّه إليها النص؟'
          then 'قال الشاعر: «فحضارةُ الإنسانِ فيضُ تعاونٍ بين الجميعِ على مدى السنوات». ما الفكرة العامة التي يوجّه إليها هذا المعنى؟'
        when 'في مفردات «يا شام»، مَن المقصود بـ«الرّاقي»؟'
          then 'قال الشاعر: «يا شامُ روحي على مغناكِ حائمةٌ، هل ترفقين بجرحٍ خابَ راقيهِ؟». مَن المقصود بـ«الرّاقي» في البيت؟'
        else v_old_question.prompt
      end;

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
        v_new_prompt,
        v_old_question.origin,
        v_old_question.source_page_start,
        v_old_question.source_page_end,
        coalesce(v_old_question.source_metadata, '{}'::jsonb) || jsonb_build_object(
          'self_contained_wording_feature', 'FLH-FEAT-2026-014',
          'remediated_from_question_code', v_old_question.question_code
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
        case when explanation is null then null else
          replace(
            replace(
              explanation,
              '؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.',
              '.'
            ),
            '؛ فهي الفكرة العامة التي يجمعها النص وفق أسئلة الاستيعاب والفهم في الدرس.',
            '.'
          )
        end,
        grading_config,
        case when correct_explanation is null then null else
          replace(
            replace(
              correct_explanation,
              '؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.',
              '.'
            ),
            '؛ فهي الفكرة العامة التي يجمعها النص وفق أسئلة الاستيعاب والفهم في الدرس.',
            '.'
          )
        end,
        case when final_incorrect_explanation is null then null else
          replace(
            replace(
              final_incorrect_explanation,
              '؛ فهي توافق معنى العبارة أو المفردة في النص ضمن هذا السياق.',
              '.'
            ),
            '؛ فهي الفكرة العامة التي يجمعها النص وفق أسئلة الاستيعاب والفهم في الدرس.',
            '.'
          )
        end
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
        case content
          when 'الكلمة وردت في وصف نشر الحب.'
            then 'ركّز على دلالة انتشار الحب واتساعه في تركيب «مُسبغ الحب».'
          when 'استحضر وصف البحر في النص.'
            then 'تخيّل بحرًا كثير الماء والموج، ثم اربط ذلك بمعنى «زاخر».'
          else content
        end,
        metadata,
        language,
        terminology_display_mode
      from public.quiz_question_hints
      where workspace_id = v_workspace
        and question_id = v_old_question.id
      order by hint_level;

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
      raise exception 'FLH_FEAT_2026_014_QUESTION_COUNT_MISMATCH:%:%:%',
        v_slug, v_source_count, v_new_count;
    end if;

    -- Publish only after the complete cloned graph exists. Historical versions
    -- and attempts remain untouched and continue to resolve through their
    -- original quiz_version_id.
    update public.quiz_versions
    set state = 'published',
        published_at = now(),
        updated_at = now()
    where workspace_id = v_workspace
      and id = v_new_version;
  end loop;
end
$migration$;
