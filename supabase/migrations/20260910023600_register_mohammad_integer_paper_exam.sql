-- Backfill the already printed/solved Mohammad paper model into the versioned
-- content system from the final approved paper + answer-key artifacts.
-- Stored math is always logical LTR; RTL is a rendering concern only.

do $migration$
declare
  v_workspace uuid := '55f9224c-8ba7-4cbc-9f88-713e6a6b41df';
  v_model_code text := 'MOH-MATH7-U1-INT-PAPER-20260909-G';
  v_subject_id bigint;
  v_book_id uuid;
  v_curriculum_id uuid;
  v_unit_id uuid;
  v_quiz_id uuid;
  v_version_id uuid;
  v_question_id uuid;
  v_question_code text;
  v_map jsonb := '{}'::jsonb;
  v_canonical jsonb;
  v_hash text;
  v_row jsonb;
  v_option text;
  v_n integer;
  v_pos integer;
  v_primary_concept uuid;
  v_addsub_concept uuid;
  v_muldiv_concept uuid;
  v_package jsonb := $json$
[
 {"n":1,"prompt":"أي تحويلٍ صحيح للعملية 18 - (-7)؟","options":["18 + 7","18 - 7","-18 + 7","-18 - 7"],"correct":1,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة — تحويل طرح السالب إلى جمع"},
 {"n":2,"prompt":"احسب: 18 - (-7)","options":["11","25","-25","-11"],"correct":2,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":3,"prompt":"احسب: (-16) - 9","options":["-7","25","-25","7"],"correct":3,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":4,"prompt":"احسب: (-23) - (-8)","options":["-31","-15","15","31"],"correct":2,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":5,"prompt":"احسب: 6 - (-13)","options":["-7","7","19","-19"],"correct":3,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة — طرح العدد السالب"},
 {"n":6,"prompt":"احسب: (-14) - 5","options":["-19","-9","9","19"],"correct":1,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":7,"prompt":"احسب: (-31) - (-12)","options":["-43","-19","19","43"],"correct":2,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":8,"prompt":"احسب: 27 - (-4)","options":["23","-23","31","-31"],"correct":3,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة — طرح العدد السالب"},
 {"n":9,"prompt":"احسب: (-9) - 6","options":["-15","-3","3","15"],"correct":1,"source_start":5,"source_end":9,"skill":"طرح الأعداد الصحيحة"},
 {"n":10,"prompt":"كانت درجة الحرارة -3° ثم انخفضت 8 درجات. ما الدرجة الجديدة؟","options":["5°","-5°","11°","-11°"],"correct":4,"source_start":5,"source_end":9,"skill":"تطبيق على طرح الأعداد الصحيحة"},
 {"n":11,"prompt":"احسب: 13 + (-18)","options":["31","5","-5","-31"],"correct":3,"source_start":5,"source_end":9,"skill":"الجمع وقواعد الإشارة"},
 {"n":12,"prompt":"احسب: (-12) + (-9)","options":["21","-21","3","-3"],"correct":2,"source_start":5,"source_end":9,"skill":"الجمع وقواعد الإشارة"},
 {"n":13,"prompt":"من دون حساب القيمة: ما إشارة الناتج؟ (-8) × (-5)","options":["موجبة","سالبة","صفر","لا يمكن تحديدها"],"correct":1,"source_start":10,"source_end":12,"skill":"الضرب وقواعد الإشارة"},
 {"n":14,"prompt":"احسب: (-8) × (-5)","options":["-40","40","-13","13"],"correct":2,"source_start":10,"source_end":12,"skill":"الضرب وقواعد الإشارة"},
 {"n":15,"prompt":"احسب: 9 × (-7)","options":["63","-63","16","-16"],"correct":2,"source_start":10,"source_end":12,"skill":"الضرب وقواعد الإشارة"},
 {"n":16,"prompt":"احسب: 54 ÷ (-6)","options":["9","-9","48","-48"],"correct":2,"source_start":10,"source_end":12,"skill":"القسمة وقواعد الإشارة"},
 {"n":17,"prompt":"احسب: (-72) ÷ (-8)","options":["-9","9","-64","64"],"correct":2,"source_start":10,"source_end":12,"skill":"القسمة وقواعد الإشارة"},
 {"n":18,"prompt":"احسب: 0 ÷ (-5)","options":["0","-5","5","غير معرّف"],"correct":1,"source_start":10,"source_end":12,"skill":"القسمة وقواعد الإشارة"},
 {"n":19,"prompt":"احسب بالترتيب الصحيح: (-6) + 14 - (-3)","options":["5","11","-11","17"],"correct":2,"source_start":5,"source_end":12,"skill":"مراجعة مختلطة — الجمع والطرح"},
 {"n":20,"prompt":"احسب بالترتيب الصحيح: (-4) × 5 + 12","options":["-32","-8","8","32"],"correct":2,"source_start":5,"source_end":12,"skill":"مراجعة مختلطة — ترتيب العمليات وقواعد الإشارة"}
]
$json$::jsonb;
begin
  if exists (
    select 1 from public.quiz_versions
    where workspace_id=v_workspace
      and settings->'paper_exam'->>'paper_model_code'=v_model_code
  ) then
    raise exception 'paper model already registered: %',v_model_code;
  end if;

  select id into v_subject_id from public.subjects where code='math' limit 1;
  select id,curriculum_id into v_book_id,v_curriculum_id
    from public.books
    where code='AR-MATH-G7-2025-2026' and subject_id=v_subject_id
    limit 1;
  select id into v_unit_id
    from public.units
    where book_id=v_book_id and slug='unit-1-numbers'
    limit 1;
  select id into v_addsub_concept
    from public.learning_concepts
    where workspace_id=v_workspace and code='sy-g7-integers-add-subtract'
    limit 1;
  select id into v_muldiv_concept
    from public.learning_concepts
    where workspace_id=v_workspace and code='sy-g7-integers-multiply-divide'
    limit 1;

  if v_subject_id is null or v_book_id is null or v_curriculum_id is null or v_unit_id is null
     or v_addsub_concept is null or v_muldiv_concept is null then
    raise exception 'Mohammad paper prerequisites are missing';
  end if;

  if exists (
    select 1 from public.quizzes
    where workspace_id=v_workspace and slug='moh-math7-u1-int-paper-20260909-g'
  ) then
    raise exception 'quiz slug already exists without paper binding';
  end if;

  insert into public.quizzes(
    workspace_id,subject_id,book_id,slug,title,description,status,curriculum_id,unit_id,quiz_kind,delivery_config
  ) values (
    v_workspace,v_subject_id,v_book_id,'moh-math7-u1-int-paper-20260909-g',
    'امتحان ورقي - رياضيات - الأعداد الصحيحة - محمد',
    'النموذج الورقي المعتمد لتثبيت الأعداد الصحيحة وقواعد الإشارة، 20 سؤالًا على صفحتين.',
    'active',v_curriculum_id,v_unit_id,'review',
    jsonb_build_object(
      'exam',jsonb_build_object('hints',false,'retry',false,'question_count',20,'instant_feedback',false,'show_results_after_submit',true),
      'learning',jsonb_build_object('hints',true,'retry',true,'instant_feedback',true)
    )
  ) returning id into v_quiz_id;

  insert into public.quiz_versions(
    workspace_id,quiz_id,version_no,state,instructions,settings,published_at,
    question_language,explanation_language,terminology_display_mode
  ) values (
    v_workspace,v_quiz_id,1,'published',
    'نسخة خلفية مطابقة للنموذج الورقي النهائي؛ لا تُستخدم كبنك أسئلة عشوائي لهذا النموذج.',
    '{}'::jsonb,now(),'ar','ar','source_only'
  ) returning id into v_version_id;

  for v_row in select value from jsonb_array_elements(v_package) loop
    v_n := (v_row->>'n')::integer;
    v_question_id := gen_random_uuid();
    v_question_code := 'Q-' || (20260910020 + v_n)::text;

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt,origin,
      source_page_start,source_page_end,source_metadata,points,
      difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,
      delivery_role,prompt_language,terminology_display_mode,question_code
    ) values (
      v_question_id,v_workspace,v_version_id,v_n,'single_choice',v_row->>'prompt','generated',
      (v_row->>'source_start')::integer,(v_row->>'source_end')::integer,
      jsonb_build_object(
        'paper_model_code',v_model_code,
        'source_book_code','AR-MATH-G7-2025-2026',
        'skill',v_row->>'skill',
        'registration_source','approved_final_paper_and_answer_key',
        'math_storage_direction','logical_ltr'
      ),
      1,3,1,1,false,'exam_pool','ar','source_only',v_question_code
    );

    v_pos := 0;
    for v_option in select jsonb_array_elements_text(v_row->'options') loop
      v_pos := v_pos + 1;
      insert into public.quiz_question_options(
        workspace_id,question_id,position,label,content
      ) values (
        v_workspace,v_question_id,v_pos,chr(64+v_pos),v_option
      );
    end loop;

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,grading_config,
      correct_explanation,final_incorrect_explanation
    ) values (
      v_question_id,v_workspace,
      jsonb_build_object('option_position',(v_row->>'correct')::integer),
      'الإجابة الصحيحة تُحدَّد بقواعد الأعداد الصحيحة وقواعد الإشارة كما في النموذج المعتمد.',
      '{}'::jsonb,
      'إجابة صحيحة.',
      'راجع قاعدة الإشارة أو تحويل طرح العدد السالب ثم أعد الحساب بالترتيب الصحيح.'
    );

    v_primary_concept := case when v_n between 13 and 18 or v_n=20 then v_muldiv_concept else v_addsub_concept end;
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
    values(v_workspace,v_question_id,v_primary_concept,true,1);
    if v_n=20 then
      insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
      values(v_workspace,v_question_id,v_addsub_concept,false,0.5);
    end if;

    v_map := v_map || jsonb_build_object(
      v_n::text,
      jsonb_build_object(
        'question_id',v_question_id,
        'question_code',v_question_code,
        'option_positions',jsonb_build_object('A',1,'B',2,'C',3,'D',4)
      )
    );
  end loop;

  update public.quiz_versions
  set settings=jsonb_build_object(
    'paper_exam',jsonb_build_object(
      'paper_model_code',v_model_code,
      'paper_page_count',2,
      'paper_question_count',20,
      'paper_question_map',v_map,
      'paper_hash_algorithm','sha256',
      'paper_hash_basis','canonical-runtime-package-v1',
      'source_book_code','AR-MATH-G7-2025-2026',
      'source_pdf_pages',jsonb_build_array(5,6,7,8,9,10,11,12),
      'approved_artifact','Mohammad_Math_G7_Integers_Paper_Exam_20Q_2Pages_Final.pdf',
      'answer_key_artifact','Mohammad_Math_G7_Integers_Paper_Exam_20Q_Answer_Key_Final.pdf',
      'approved_at','2026-09-09T16:56:42Z',
      'approval_note','Backfilled from the final printed exam and answer-key artifacts after the paper was solved.',
      'layout',jsonb_build_object('page_size','A4','orientation','portrait','columns_per_page',2,'direction','rtl'),
      'math_storage_direction','logical_ltr'
    )
  where workspace_id=v_workspace and id=v_version_id;

  v_canonical := public.flh_paper_exam_runtime_package(v_workspace,v_version_id);
  if v_canonical is null or jsonb_array_length(v_canonical) <> 20 then
    raise exception 'canonical paper package could not be rebuilt';
  end if;
  v_hash := encode(extensions.digest(convert_to(v_canonical::text,'UTF8'),'sha256'),'hex');

  update public.quiz_versions
  set settings=jsonb_set(
    jsonb_set(
      jsonb_set(settings,'{paper_exam,paper_canonical_package}',v_canonical,true),
      '{paper_exam,paper_content_hash}',to_jsonb(v_hash),true),
    '{paper_exam,paper_runtime_content_hash}',to_jsonb(v_hash),true)
  where workspace_id=v_workspace and id=v_version_id;
end;
$migration$;
