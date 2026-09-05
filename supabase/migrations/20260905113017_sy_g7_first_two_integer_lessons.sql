do $$
declare
  v_workspace uuid;
  v_curriculum uuid;
  v_math bigint;
  v_mohammad uuid;
  v_program uuid;
  v_program_subject uuid;
  v_book uuid;
  v_unit uuid;
  v_lesson_add uuid;
  v_lesson_mul uuid;
  v_concept_add uuid;
  v_concept_mul uuid;
  v_quiz uuid;
  v_version uuid;
  v_question uuid;
  v_item jsonb;
  v_option text;
  v_hint text;
  v_i integer;
  v_items jsonb;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub';
  select id into v_curriculum from public.curricula where code='syrian-national';
  select id into v_math from public.subjects where code='math';
  select id into v_mohammad from public.learners where workspace_id=v_workspace and slug='mohammad';
  if v_workspace is null or v_curriculum is null or v_math is null or v_mohammad is null then
    raise exception 'Required Family Learning Hub data is missing';
  end if;

  select id into v_book from public.books where code='AR-MATH-G7-2025-2026';
  if v_book is null then
    insert into public.books(subject_id,code,title,grade_level,school_year,language,pdf_pages,source_metadata,curriculum_id,source_kind)
    values(v_math,'AR-MATH-G7-2025-2026','الرياضيات - كتاب الطالب - الصف السابع الأساسي',7,'2025-2026','ar',160,
      jsonb_build_object(
        'assigned_student','Mohammad',
        'visual_book_url','https://docs.google.com/presentation/d/1bySvcJ5wSeIUCvvEkYBlDE-Xe9SVxG__aZ-BnVue-CE/edit',
        'visual_page_mapping','PDF page = Google Slides slide, 1:1',
        'math_source_of_truth','visual',
        'academic_year_on_cover','2025-2026',
        'edition_check_date','2026-08-31',
        'edition_status','2025-2026 cover edition; 2026-2027 edition not yet directly verified'
      ),v_curriculum,'textbook')
    returning id into v_book;
  end if;

  insert into public.learning_programs
    (workspace_id,slug,code,title,description,program_type,curriculum_id,grade_level,school_year,primary_language,status,metadata)
  values
    (v_workspace,'syrian-g7-2026-2027','SY-G7-2026-2027','المنهاج السوري — الصف السابع — 2026–2027',
     'مسار محمد للصف السابع. المصدر المتاح حاليًا هو كتاب الرياضيات ذو غلاف 2025–2026، ويُستخدم مع إظهار حالة التحقق من إصدار 2026–2027.',
     'curriculum',v_curriculum,7,'2026-2027','ar','active',
     jsonb_build_object('learner','mohammad','source_book_code','AR-MATH-G7-2025-2026','source_book_year','2025-2026','current_school_year','2026-2027','source_edition_verified_for_2026_2027',false))
  on conflict (workspace_id,slug) do update
  set title=excluded.title,description=excluded.description,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,
      school_year=excluded.school_year,primary_language=excluded.primary_language,status='active',metadata=excluded.metadata,updated_at=now();
  select id into v_program from public.learning_programs where workspace_id=v_workspace and slug='syrian-g7-2026-2027';

  insert into public.program_subjects(workspace_id,program_id,subject_id,display_name,sort_order,metadata)
  values(v_workspace,v_program,v_math,'الرياضيات',10,jsonb_build_object('book_code','AR-MATH-G7-2025-2026'))
  on conflict (program_id,subject_id) do update set display_name=excluded.display_name,sort_order=excluded.sort_order,metadata=excluded.metadata,updated_at=now();
  select id into v_program_subject from public.program_subjects where program_id=v_program and subject_id=v_math;

  insert into public.program_books(workspace_id,program_id,book_id,program_subject_id,is_required,sort_order,metadata)
  select v_workspace,v_program,v_book,v_program_subject,true,10,jsonb_build_object('source_year','2025-2026','visual_authoritative',true)
  where not exists (select 1 from public.program_books where program_id=v_program and book_id=v_book);

  update public.learner_program_enrollments set is_primary=false,updated_at=now()
  where workspace_id=v_workspace and learner_id=v_mohammad and status='active';
  insert into public.learner_program_enrollments(workspace_id,learner_id,program_id,status,is_primary,started_at,metadata)
  values(v_workspace,v_mohammad,v_program,'active',true,current_date,jsonb_build_object('reason','grade_7_new_school_year','source_book_year','2025-2026'))
  on conflict (learner_id,program_id) do update
  set status='active',is_primary=true,ended_at=null,metadata=excluded.metadata,updated_at=now();

  select id into v_unit from public.units where book_id=v_book and slug='unit-1-numbers';
  if v_unit is null then
    insert into public.units(book_id,slug,title,sort_order,metadata)
    values(v_book,'unit-1-numbers','الوحدة الأولى — الأعداد والعمليات',1,jsonb_build_object('pdf_pages','3-27'))
    returning id into v_unit;
  end if;

  select id into v_lesson_add from public.lessons where book_id=v_book and title='الأعداد الصحيحة (الجمع والطرح)' limit 1;
  if v_lesson_add is null then
    insert into public.lessons(book_id,unit_label,title,pdf_page_start,pdf_page_end,sort_order,metadata,unit_id)
    values(v_book,'1','الأعداد الصحيحة (الجمع والطرح)',5,9,20,
      jsonb_build_object('lesson_code','1-2','video_title','الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026','video_channel','منصة دليل التعليمية','video_url','https://www.youtube.com/watch?v=RknLLSf_fss'),v_unit)
    returning id into v_lesson_add;
  end if;

  select id into v_lesson_mul from public.lessons where book_id=v_book and title='الأعداد الصحيحة (الضرب والقسمة)' limit 1;
  if v_lesson_mul is null then
    insert into public.lessons(book_id,unit_label,title,pdf_page_start,pdf_page_end,sort_order,metadata,unit_id)
    values(v_book,'1','الأعداد الصحيحة (الضرب والقسمة)',10,12,30,
      jsonb_build_object('lesson_code','1-3','video_title','الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026','video_channel','منصة دليل التعليمية','video_url','https://www.youtube.com/watch?v=t64L9HI4mvQ'),v_unit)
    returning id into v_lesson_mul;
  end if;

  insert into public.learning_concepts(workspace_id,subject_id,curriculum_id,code,title,description,grade_level,metadata)
  values
    (v_workspace,v_math,v_curriculum,'sy-g7-integers-add-subtract','الأعداد الصحيحة: الجمع والطرح','الأعداد الموجبة والسالبة، المعكوس الجمعي، جمع الأعداد الصحيحة وطرحها بتحويل الطرح إلى جمع المعكوس.',7,jsonb_build_object('book_code','AR-MATH-G7-2025-2026','pdf_pages','5-9')),
    (v_workspace,v_math,v_curriculum,'sy-g7-integers-multiply-divide','الأعداد الصحيحة: الضرب والقسمة','ضرب الأعداد الصحيحة وقسمتها مع تطبيق قواعد الإشارة للأعداد ذات الإشارات المتشابهة والمختلفة.',7,jsonb_build_object('book_code','AR-MATH-G7-2025-2026','pdf_pages','10-12'))
  on conflict (workspace_id,code) do update
  set title=excluded.title,description=excluded.description,curriculum_id=excluded.curriculum_id,grade_level=excluded.grade_level,metadata=excluded.metadata,updated_at=now();
  select id into v_concept_add from public.learning_concepts where workspace_id=v_workspace and code='sy-g7-integers-add-subtract';
  select id into v_concept_mul from public.learning_concepts where workspace_id=v_workspace and code='sy-g7-integers-multiply-divide';

  insert into public.quizzes(workspace_id,subject_id,book_id,lesson_id,slug,title,description,status,curriculum_id,unit_id,quiz_kind,delivery_config)
  values(v_workspace,v_math,v_book,v_lesson_add,'sy-g7-integers-add-subtract-v1','الأعداد الصحيحة — الجمع والطرح',
    'قبل Learning Mode: تأكد أنك شاهدت الفيديو «الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026» من قناة منصة دليل التعليمية. تعلّم من كل سؤال، ثم انتقل إلى Exam Mode عندما تصبح جاهزًا.',
    'active',v_curriculum,v_unit,'lesson',
    jsonb_build_object(
      'learning',jsonb_build_object('hints',true,'retry',true,'adaptive',true,'remediation',true,'instant_feedback',true,'progressive_hints',true),
      'exam',jsonb_build_object('question_count',6,'independent_question_pool',true),
      'video',jsonb_build_object('title','الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026','channel','منصة دليل التعليمية','url','https://www.youtube.com/watch?v=RknLLSf_fss'),
      'source_pages',jsonb_build_array(5,9)))
  on conflict (workspace_id,slug) do update
  set title=excluded.title,description=excluded.description,status='active',delivery_config=excluded.delivery_config,updated_at=now();
  select id into v_quiz from public.quizzes where workspace_id=v_workspace and slug='sy-g7-integers-add-subtract-v1';
  select id into v_version from public.quiz_versions where workspace_id=v_workspace and quiz_id=v_quiz and version_no=1;
  if v_version is null then
    insert into public.quiz_versions(workspace_id,quiz_id,version_no,state,instructions,settings,published_at,question_language,explanation_language,terminology_display_mode)
    values(v_workspace,v_quiz,1,'published',
      'محمد: قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026». في وضع التعلّم استخدم التلميحات وتعلّم من الخطأ. بعد الانتهاء افتح Exam Mode؛ لن يظهر لك التصحيح أثناء الامتحان، وستظهر النتيجة بعد التسليم.',
      jsonb_build_object('max_attempts',4,'two_mode_model',true,'learning_questions_distinct_from_exam',true),now(),'ar','ar','source_only')
    returning id into v_version;
  end if;
  insert into public.program_quizzes(workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata)
  values(v_workspace,v_program,v_quiz,v_program_subject,'available',10,jsonb_build_object('lesson_code','1-2','modes',jsonb_build_array('learning','exam')))
  on conflict (program_id,quiz_id) do update set program_subject_id=excluded.program_subject_id,availability='available',sort_order=excluded.sort_order,metadata=excluded.metadata,updated_at=now();

  v_items := '[
    {"code":"Q-20260905101","pos":1,"role":"core","prompt":"كانت درجة الحرارة 6 درجات تحت الصفر. أي عدد صحيح يمثّل هذه الدرجة؟","opts":["6","-6","0","+1","-1"],"correct":2,"explain":"عبارة تحت الصفر تعني عدداً سالباً؛ لذلك 6 درجات تحت الصفر تُمثّل بالعدد -6.","hints":["حدّد موقع الدرجة بالنسبة إلى الصفر: هل هي فوق الصفر أم تحته؟","كل قيمة تحت الصفر نمثّلها بعدد سالب.","ضع إشارة السالب أمام مقدار 6.","التمثيل الصحيح هو -6."]},
    {"code":"Q-20260905102","pos":2,"role":"core","prompt":"احسب: (-8) + (-5)","opts":["-13","-3","3","13","0"],"correct":1,"explain":"العددان لهما الإشارة نفسها (سالب). نجمع القيمتين 8 + 5 = 13 ونحافظ على الإشارة السالبة، فيكون الناتج -13.","hints":["لاحظ الإشارتين: هل هما متشابهتان أم مختلفتان؟","عند جمع عددين سالبين نجمع قيمتيهما المطلقتين.","8 + 5 = 13، ثم احتفظ بإشارة السالب.","الناتج -13."]},
    {"code":"Q-20260905103","pos":3,"role":"core","prompt":"احسب: (-7) + 12","opts":["-19","-5","5","19","0"],"correct":3,"explain":"الإشارتان مختلفتان. نطرح القيمتين 12 - 7 = 5، ثم نأخذ إشارة العدد الأكبر قيمةً مطلقة وهو 12 الموجب؛ إذن الناتج 5.","hints":["الإشارتان مختلفتان، فلا تجمع 7 و12 مباشرة.","اطرح القيمة المطلقة الأصغر من الأكبر: 12 - 7.","الناتج العددي 5، وإشارته إشارة العدد ذي القيمة المطلقة الأكبر.","لأن 12 هو الأكبر وإشارته موجبة، فالناتج 5."]},
    {"code":"Q-20260905104","pos":4,"role":"core","prompt":"احسب: 9 + (-9)","opts":["18","-18","9","-9","0"],"correct":5,"explain":"9 و-9 عددان متعاكسان (معكوسان جمعياً). مجموع أي عدد ومعكوسه الجمعي يساوي صفراً.","hints":["قارن العددين: لهما المقدار نفسه وإشارتان متعاكستان.","هذان العددان يُسمّيان متعاكسين أو معكوسين جمعياً.","مجموع العدد ومعكوسه الجمعي يساوي صفراً.","9 + (-9) = 0."]},
    {"code":"Q-20260905105","pos":5,"role":"core","prompt":"احسب: 6 - (-9)","opts":["-15","-3","3","15","0"],"correct":4,"explain":"نحوّل الطرح إلى جمع المعكوس: 6 - (-9) = 6 + 9 = 15. لذلك طرح عدد سالب يعادل جمع العدد الموجب المقابل.","hints":["في الطرح، حوّل a - b إلى a + (-b).","المعكوس الجمعي للعدد -9 هو +9.","تصبح المسألة 6 + 9.","6 + 9 = 15."]},
    {"code":"Q-20260905111","pos":101,"role":"remediation_pool","prompt":"تدريب مساعد: احسب (-4) + (-7)","opts":["-11","-3","3","11","0"],"correct":1,"explain":"الإشارتان سالبتان، لذلك نجمع 4 + 7 = 11 ونبقي إشارة السالب: -11.","hints":["الإشارتان متشابهتان.","اجمع القيمتين المطلقتين 4 و7.","4 + 7 = 11، واحتفظ بالسالب.","الناتج -11."]},
    {"code":"Q-20260905112","pos":102,"role":"remediation_pool","prompt":"تدريب مساعد: احسب 10 - (-3)","opts":["7","-7","13","-13","0"],"correct":3,"explain":"10 - (-3) = 10 + 3 = 13 لأن طرح السالب يتحول إلى جمع موجبه.","hints":["حوّل الطرح إلى جمع المعكوس.","معكوس -3 هو +3.","المسألة تصبح 10 + 3.","الناتج 13."]},
    {"code":"Q-20260905121","pos":201,"role":"exam_pool","prompt":"احسب: (-11) + (-6)","opts":["-17","-5","5","17","0"],"correct":1,"explain":"الإشارتان متشابهتان: 11 + 6 = 17 مع الإشارة السالبة، إذن -17."},
    {"code":"Q-20260905122","pos":202,"role":"exam_pool","prompt":"احسب: (-13) + 8","opts":["-21","-5","5","21","0"],"correct":2,"explain":"الإشارتان مختلفتان: 13 - 8 = 5، والقيمة المطلقة الأكبر للعدد السالب -13، إذن الناتج -5."},
    {"code":"Q-20260905123","pos":203,"role":"exam_pool","prompt":"احسب: 15 + (-19)","opts":["-34","-4","4","34","0"],"correct":2,"explain":"الإشارتان مختلفتان: 19 - 15 = 4، وإشارة الأكبر قيمة مطلقة سالبة، فيكون الناتج -4."},
    {"code":"Q-20260905124","pos":204,"role":"exam_pool","prompt":"احسب: 15 - (-4)","opts":["11","-11","19","-19","0"],"correct":3,"explain":"15 - (-4) = 15 + 4 = 19."},
    {"code":"Q-20260905125","pos":205,"role":"exam_pool","prompt":"احسب: (-9) - 12","opts":["-21","-3","3","21","0"],"correct":1,"explain":"(-9) - 12 = (-9) + (-12) = -21."},
    {"code":"Q-20260905126","pos":206,"role":"exam_pool","prompt":"احسب: (-18) - (-7)","opts":["-25","-11","11","25","0"],"correct":2,"explain":"(-18) - (-7) = (-18) + 7 = -11."}
  ]'::jsonb;

  for v_item in select value from jsonb_array_elements(v_items) loop
    insert into public.quiz_questions(workspace_id,quiz_version_id,position,question_type,prompt,origin,source_page_start,source_page_end,source_metadata,points,difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,prompt_language,terminology_display_mode,question_code)
    values(v_workspace,v_version,(v_item->>'pos')::int,'single_choice',v_item->>'prompt','generated',5,9,
      jsonb_build_object('source_type','GENERATED_SIMILAR','book_code','AR-MATH-G7-2025-2026','lesson_code','1-2','visual_pages_verified',true),
      1,case when (v_item->>'role')='exam_pool' then 2 else 1 end,4,3,true,v_item->>'role','ar','source_only',v_item->>'code')
    returning id into v_question;
    v_i := 0;
    for v_option in select value from jsonb_array_elements_text(v_item->'opts') loop
      v_i := v_i + 1;
      insert into public.quiz_question_options(workspace_id,question_id,position,label,content)
      values(v_workspace,v_question,v_i,chr(64+v_i),v_option);
    end loop;
    insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation)
    values(v_question,v_workspace,jsonb_build_object('option_position',(v_item->>'correct')::int),v_item->>'explain',v_item->>'explain',v_item->>'explain');
    if v_item ? 'hints' then
      v_i := 0;
      for v_hint in select value from jsonb_array_elements_text(v_item->'hints') loop
        v_i := v_i + 1;
        insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode)
        values(v_workspace,v_question,v_i,case v_i when 1 then 'nudge' when 2 then 'guide' when 3 then 'strong_guide' else 'near_solution' end,v_hint,'ar','source_only');
      end loop;
    end if;
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
    values(v_workspace,v_question,v_concept_add,true,1);
  end loop;

  insert into public.quizzes(workspace_id,subject_id,book_id,lesson_id,slug,title,description,status,curriculum_id,unit_id,quiz_kind,delivery_config)
  values(v_workspace,v_math,v_book,v_lesson_mul,'sy-g7-integers-multiply-divide-v1','الأعداد الصحيحة — الضرب والقسمة',
    'قبل Learning Mode: تأكد أنك شاهدت الفيديو «الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026» من قناة منصة دليل التعليمية. تعلّم قاعدة الإشارات من الأسئلة، ثم انتقل إلى Exam Mode.',
    'active',v_curriculum,v_unit,'lesson',
    jsonb_build_object(
      'learning',jsonb_build_object('hints',true,'retry',true,'adaptive',true,'remediation',true,'instant_feedback',true,'progressive_hints',true),
      'exam',jsonb_build_object('question_count',6,'independent_question_pool',true),
      'video',jsonb_build_object('title','الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026','channel','منصة دليل التعليمية','url','https://www.youtube.com/watch?v=t64L9HI4mvQ'),
      'source_pages',jsonb_build_array(10,12)))
  on conflict (workspace_id,slug) do update
  set title=excluded.title,description=excluded.description,status='active',delivery_config=excluded.delivery_config,updated_at=now();
  select id into v_quiz from public.quizzes where workspace_id=v_workspace and slug='sy-g7-integers-multiply-divide-v1';
  select id into v_version from public.quiz_versions where workspace_id=v_workspace and quiz_id=v_quiz and version_no=1;
  if v_version is null then
    insert into public.quiz_versions(workspace_id,quiz_id,version_no,state,instructions,settings,published_at,question_language,explanation_language,terminology_display_mode)
    values(v_workspace,v_quiz,1,'published',
      'محمد: قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026». تعلّم قاعدة الإشارات من كل سؤال، وبعدها افتح Exam Mode. في الامتحان لا توجد تلميحات ولا يظهر التصحيح قبل التسليم.',
      jsonb_build_object('max_attempts',4,'two_mode_model',true,'learning_questions_distinct_from_exam',true),now(),'ar','ar','source_only')
    returning id into v_version;
  end if;
  insert into public.program_quizzes(workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata)
  values(v_workspace,v_program,v_quiz,v_program_subject,'available',20,jsonb_build_object('lesson_code','1-3','modes',jsonb_build_array('learning','exam')))
  on conflict (program_id,quiz_id) do update set program_subject_id=excluded.program_subject_id,availability='available',sort_order=excluded.sort_order,metadata=excluded.metadata,updated_at=now();

  v_items := '[
    {"code":"Q-20260905201","pos":1,"role":"core","prompt":"من دون حساب القيمة أولاً: ما إشارة ناتج (-6) × (-4)؟","opts":["موجبة","سالبة","صفر","لا يمكن تحديدها","لا يوجد ناتج"],"correct":1,"explain":"عند ضرب عددين لهما الإشارة نفسها يكون الناتج موجباً. هنا سالب × سالب = موجب.","hints":["ركّز أولاً على الإشارتين فقط.","الإشارتان متشابهتان: سالب وسالب.","في الضرب: الإشارتان المتشابهتان تعطيان ناتجاً موجباً.","إشارة الناتج موجبة."]},
    {"code":"Q-20260905202","pos":2,"role":"core","prompt":"احسب: (-6) × (-4)","opts":["-24","-10","10","24","0"],"correct":4,"explain":"نضرب القيمتين 6 × 4 = 24، وبما أن الإشارتين متشابهتان فالناتج موجب: 24.","hints":["افصل بين حساب المقدار وتحديد الإشارة.","6 × 4 = 24.","سالب × سالب = موجب.","الناتج 24."]},
    {"code":"Q-20260905203","pos":3,"role":"core","prompt":"احسب: 8 × (-3)","opts":["-24","-11","11","24","0"],"correct":1,"explain":"8 × 3 = 24، والإشارتان مختلفتان (موجب وسالب)، لذا الناتج سالب: -24.","hints":["احسب 8 × 3 أولاً.","الإشارتان مختلفتان: موجب وسالب.","في الضرب، الإشارتان المختلفتان تعطيان ناتجاً سالباً.","الناتج -24."]},
    {"code":"Q-20260905204","pos":4,"role":"core","prompt":"احسب: (-42) ÷ 6","opts":["-7","-6","6","7","0"],"correct":1,"explain":"42 ÷ 6 = 7، والإشارتان مختلفتان، لذلك الناتج سالب: -7.","hints":["احسب 42 ÷ 6 من دون إشارات أولاً.","42 ÷ 6 = 7.","سالب ÷ موجب: إشارتان مختلفتان، إذن الناتج سالب.","الناتج -7."]},
    {"code":"Q-20260905205","pos":5,"role":"core","prompt":"احسب: (-56) ÷ (-7)","opts":["-8","-7","7","8","0"],"correct":4,"explain":"56 ÷ 7 = 8، والإشارتان متشابهتان (سالب وسالب)، لذلك الناتج موجب: 8.","hints":["احسب 56 ÷ 7 أولاً.","الإشارتان في القسمة متشابهتان.","سالب ÷ سالب يعطي ناتجاً موجباً.","الناتج 8."]},
    {"code":"Q-20260905211","pos":101,"role":"remediation_pool","prompt":"تدريب مساعد: احسب (-5) × 7","opts":["-35","-12","12","35","0"],"correct":1,"explain":"5 × 7 = 35، والإشارتان مختلفتان، لذلك الناتج -35.","hints":["احسب 5 × 7.","لديك سالب × موجب.","الإشارتان مختلفتان، إذن الناتج سالب.","الناتج -35."]},
    {"code":"Q-20260905212","pos":102,"role":"remediation_pool","prompt":"تدريب مساعد: احسب (-32) ÷ (-4)","opts":["-8","-4","4","8","0"],"correct":4,"explain":"32 ÷ 4 = 8، وسالب ÷ سالب يعطي موجباً، لذلك الناتج 8.","hints":["احسب 32 ÷ 4 أولاً.","الإشارتان متشابهتان.","في القسمة، الإشارتان المتشابهتان تعطيان موجباً.","الناتج 8."]},
    {"code":"Q-20260905221","pos":201,"role":"exam_pool","prompt":"احسب: (-7) × (-8)","opts":["-56","-15","15","56","0"],"correct":4,"explain":"7 × 8 = 56، والإشارتان متشابهتان، لذلك الناتج موجب: 56."},
    {"code":"Q-20260905222","pos":202,"role":"exam_pool","prompt":"احسب: (-9) × 5","opts":["-45","-14","14","45","0"],"correct":1,"explain":"9 × 5 = 45، والإشارتان مختلفتان، لذلك الناتج -45."},
    {"code":"Q-20260905223","pos":203,"role":"exam_pool","prompt":"احسب: 11 × (-4)","opts":["-44","-15","15","44","0"],"correct":1,"explain":"11 × 4 = 44، وموجب × سالب يعطي ناتجاً سالباً: -44."},
    {"code":"Q-20260905224","pos":204,"role":"exam_pool","prompt":"احسب: 48 ÷ (-6)","opts":["-8","-6","6","8","0"],"correct":1,"explain":"48 ÷ 6 = 8، والإشارتان مختلفتان، لذلك الناتج -8."},
    {"code":"Q-20260905225","pos":205,"role":"exam_pool","prompt":"احسب: (-63) ÷ (-7)","opts":["-9","-7","7","9","0"],"correct":4,"explain":"63 ÷ 7 = 9، وسالب ÷ سالب يعطي ناتجاً موجباً: 9."},
    {"code":"Q-20260905226","pos":206,"role":"exam_pool","prompt":"احسب: 0 ÷ (-5)","opts":["-5","-1","0","1","5"],"correct":3,"explain":"صفر مقسوماً على أي عدد غير صفري يساوي صفراً، لذلك 0 ÷ (-5) = 0."}
  ]'::jsonb;

  for v_item in select value from jsonb_array_elements(v_items) loop
    insert into public.quiz_questions(workspace_id,quiz_version_id,position,question_type,prompt,origin,source_page_start,source_page_end,source_metadata,points,difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,prompt_language,terminology_display_mode,question_code)
    values(v_workspace,v_version,(v_item->>'pos')::int,'single_choice',v_item->>'prompt','generated',10,12,
      jsonb_build_object('source_type','GENERATED_SIMILAR','book_code','AR-MATH-G7-2025-2026','lesson_code','1-3','visual_pages_verified',true),
      1,case when (v_item->>'role')='exam_pool' then 2 else 1 end,4,3,true,v_item->>'role','ar','source_only',v_item->>'code')
    returning id into v_question;
    v_i := 0;
    for v_option in select value from jsonb_array_elements_text(v_item->'opts') loop
      v_i := v_i + 1;
      insert into public.quiz_question_options(workspace_id,question_id,position,label,content)
      values(v_workspace,v_question,v_i,chr(64+v_i),v_option);
    end loop;
    insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation)
    values(v_question,v_workspace,jsonb_build_object('option_position',(v_item->>'correct')::int),v_item->>'explain',v_item->>'explain',v_item->>'explain');
    if v_item ? 'hints' then
      v_i := 0;
      for v_hint in select value from jsonb_array_elements_text(v_item->'hints') loop
        v_i := v_i + 1;
        insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode)
        values(v_workspace,v_question,v_i,case v_i when 1 then 'nudge' when 2 then 'guide' when 3 then 'strong_guide' else 'near_solution' end,v_hint,'ar','source_only');
      end loop;
    end if;
    insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight)
    values(v_workspace,v_question,v_concept_mul,true,1);
  end loop;
end $$;
