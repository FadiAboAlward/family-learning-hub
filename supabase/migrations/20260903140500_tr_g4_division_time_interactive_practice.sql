-- Interactive mathematics practice for Turkish Grade 4 readiness.
-- Additive only: creates a reusable support track, concepts, one adaptive quiz,
-- and enrolls Aya in the track without changing her primary program.

do $$
declare
  v_workspace uuid;
  v_curriculum uuid;
  v_math_subject bigint;
  v_program uuid;
  v_program_subject uuid;
  v_aya uuid;
  v_quiz uuid;
  v_version uuid;
  v_q uuid;
  v_concept uuid;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub';
  select id into v_curriculum from public.curricula where code='turkiye-meb';
  select id into v_math_subject from public.subjects where code='math';
  select id into v_aya from public.learners where workspace_id=v_workspace and slug='aya';

  if v_workspace is null or v_curriculum is null or v_math_subject is null then
    raise exception 'Required Family Learning Hub catalog data is missing';
  end if;

  insert into public.learning_programs
    (workspace_id,slug,code,title,description,program_type,curriculum_id,grade_level,school_year,primary_language,status,metadata)
  values
    (v_workspace,
     'turkiye-g4-readiness-2026',
     'TR-G4-READINESS-2026',
     'تقوية الرياضيات التركية — مراجعة الصف الرابع',
     'مسار مراجعة قصير قبل الصف الخامس، يركّز مبدئيًا على القسمة والزمن ويقبل التوسع لمفاهيم أخرى.',
     'track',v_curriculum,4,'2025-2026','tr','active',
     jsonb_build_object('purpose','grade_5_readiness','adaptive',true,'interactive_visuals',true))
  on conflict (workspace_id,slug) do update
  set title=excluded.title,
      description=excluded.description,
      curriculum_id=excluded.curriculum_id,
      grade_level=excluded.grade_level,
      school_year=excluded.school_year,
      primary_language=excluded.primary_language,
      status='active',
      metadata=excluded.metadata,
      updated_at=now();

  select id into v_program
  from public.learning_programs
  where workspace_id=v_workspace and slug='turkiye-g4-readiness-2026';

  insert into public.program_subjects
    (workspace_id,program_id,subject_id,display_name,sort_order,metadata)
  values
    (v_workspace,v_program,v_math_subject,'Matematik — الرياضيات',10,
     jsonb_build_object('bilingual',true,'readiness_track',true))
  on conflict (program_id,subject_id) do update
  set display_name=excluded.display_name,
      sort_order=excluded.sort_order,
      metadata=excluded.metadata,
      updated_at=now();

  select id into v_program_subject
  from public.program_subjects
  where program_id=v_program and subject_id=v_math_subject;

  if v_aya is not null then
    insert into public.learner_program_enrollments
      (workspace_id,learner_id,program_id,status,is_primary,started_at,metadata)
    values
      (v_workspace,v_aya,v_program,'active',false,current_date,
       jsonb_build_object('reason','targeted_math_readiness','added_by','interactive-practice-v1'))
    on conflict (learner_id,program_id) do update
    set status='active',
        is_primary=false,
        ended_at=null,
        metadata=excluded.metadata,
        updated_at=now();
  end if;

  -- Granular concepts so parent reporting can distinguish the exact weakness.
  insert into public.learning_concepts
    (workspace_id,subject_id,curriculum_id,code,title,description,grade_level,metadata)
  values
    (v_workspace,v_math_subject,v_curriculum,'tr-g4-division-equal-groups','القسمة إلى مجموعات متساوية — Eşit Gruplama','فهم القسمة كتوزيع كمية بالتساوي على مجموعات.',4,'{"domain":"division","bilingual":true}'::jsonb),
    (v_workspace,v_math_subject,v_curriculum,'tr-g4-division-facts','حقائق القسمة — Bölme İşlemi','استخدام حقائق الضرب والقسمة لإيجاد الناتج بسرعة ودقة.',4,'{"domain":"division","bilingual":true}'::jsonb),
    (v_workspace,v_math_subject,v_curriculum,'tr-g4-time-read-clock','قراءة الساعة — Saat Okuma','قراءة الوقت بالساعات والدقائق من ساعة عقارب.',4,'{"domain":"time","bilingual":true}'::jsonb),
    (v_workspace,v_math_subject,v_curriculum,'tr-g4-time-elapsed','حساب المدة — Geçen Süre','حساب الزمن المنقضي بين وقت بداية ووقت نهاية.',4,'{"domain":"time","bilingual":true}'::jsonb),
    (v_workspace,v_math_subject,v_curriculum,'tr-g4-time-convert','تحويل الساعة والدقيقة — Saat/Dakika Dönüşümü','التحويل بين الساعات والدقائق في مسائل بسيطة.',4,'{"domain":"time","bilingual":true}'::jsonb)
  on conflict (workspace_id,code) do update
  set title=excluded.title,
      description=excluded.description,
      curriculum_id=excluded.curriculum_id,
      grade_level=excluded.grade_level,
      metadata=excluded.metadata,
      updated_at=now();

  insert into public.quizzes
    (workspace_id,subject_id,curriculum_id,slug,title,description,status,quiz_kind,delivery_config)
  values
    (v_workspace,v_math_subject,v_curriculum,
     'tr-g4-division-time-interactive-v1',
     'تحدّي القسمة والزمن — Division & Time',
     'تدريب بصري تفاعلي قصير: افهمي، جرّبي، ثم جاوبي. النتائج تُحفظ حسب المفهوم.',
     'active','adaptive',
     jsonb_build_object(
       'learning',jsonb_build_object(
         'hints',true,'retry',true,'adaptive',true,'remediation',true,
         'instant_feedback',true,'progressive_hints',true,'visual_interactions',true
       )
     ))
  on conflict (workspace_id,slug) do update
  set title=excluded.title,
      description=excluded.description,
      status='active',
      quiz_kind=excluded.quiz_kind,
      delivery_config=excluded.delivery_config,
      updated_at=now();

  select id into v_quiz
  from public.quizzes
  where workspace_id=v_workspace and slug='tr-g4-division-time-interactive-v1';

  select id into v_version
  from public.quiz_versions
  where workspace_id=v_workspace and quiz_id=v_quiz and version_no=1;

  if v_version is null then
    insert into public.quiz_versions
      (workspace_id,quiz_id,version_no,state,instructions,settings,published_at,question_language,explanation_language,terminology_display_mode)
    values
      (v_workspace,v_quiz,1,'published',
       'شاهدي التمثيل البصري أولًا. اختاري إجابة، واستعملي التلميح إذا احتجتِ.',
       jsonb_build_object('max_attempts',4,'scoring_weights',jsonb_build_array(1.0,0.75,0.5,0.25),'prototype','interactive-practice-v1'),
       now(),'ar','ar','dual_term')
    returning id into v_version;
  end if;

  insert into public.program_quizzes
    (workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata)
  values
    (v_workspace,v_program,v_quiz,v_program_subject,'available',10,
     jsonb_build_object('featured',true,'practice_type','interactive'))
  on conflict (program_id,quiz_id) do update
  set program_subject_id=excluded.program_subject_id,
      availability='available',
      sort_order=excluded.sort_order,
      metadata=excluded.metadata,
      updated_at=now();

  -- Q1: equal groups visual.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,1,'single_choice',
         'عندنا 24 نجمة ونريد توزيعها بالتساوي على 6 مجموعات. كم نجمة في كل مجموعة؟  (24 ÷ 6 = ?)',
         'generated',
         jsonb_build_object('activity_kind','division_groups','total',24,'groups',6,'tap_to_count',true,'visual_required',true),
         1,1,4,3,true,'core','ar','dual_term','Q-2026090301'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=1);

  -- Q2: division fact.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,2,'single_choice',
         'إذا كان 7 × 12 = 84، فما ناتج 84 ÷ 7؟',
         'generated',
         jsonb_build_object('activity_kind','fact_bridge','multiplication','7 × 12 = 84','division','84 ÷ 7 = ?','visual_required',true),
         1,2,4,3,true,'core','ar','dual_term','Q-2026090302'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=2);

  -- Q3: analog clock.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,3,'single_choice',
         'انظري إلى الساعة. كم الوقت؟  (Saat kaç?)',
         'generated',
         jsonb_build_object('activity_kind','analog_clock','hour',3,'minute',30,'show_minute_marks_on_tap',true,'visual_required',true),
         1,1,4,3,true,'core','ar','dual_term','Q-2026090303'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=3);

  -- Q4: elapsed time timeline.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,4,'single_choice',
         'بدأ النشاط الساعة 16:20 وانتهى الساعة 17:45. كم استغرق؟  (Geçen süre)',
         'generated',
         jsonb_build_object('activity_kind','elapsed_timeline','start','16:20','end','17:45','visual_required',true),
         1,3,4,3,true,'core','ar','dual_term','Q-2026090304'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=4);

  -- Q5: hour/minute conversion.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,5,'single_choice',
         '2 saat 30 dakika كم دقيقة تساوي؟',
         'generated',
         jsonb_build_object('activity_kind','time_conversion','hours',2,'minutes',30,'visual_required',true),
         1,2,4,3,true,'core','ar','dual_term','Q-2026090305'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=5);

  -- Remediation pool: same concepts, fresh variants.
  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,101,'single_choice',
         'وزّعنا 18 كرة بالتساوي على 3 صناديق. كم كرة في كل صندوق؟',
         'generated',
         jsonb_build_object('activity_kind','division_groups','total',18,'groups',3,'tap_to_count',true,'visual_required',true),
         1,1,4,3,true,'remediation_pool','ar','dual_term','Q-2026090311'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=101);

  insert into public.quiz_questions
    (workspace_id,quiz_version_id,position,question_type,prompt,origin,source_metadata,points,
     difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,delivery_role,
     prompt_language,terminology_display_mode,question_code)
  select v_workspace,v_version,102,'single_choice',
         'بدأت القراءة الساعة 10:15 وانتهت الساعة 11:00. كم دقيقة استمرت؟',
         'generated',
         jsonb_build_object('activity_kind','elapsed_timeline','start','10:15','end','11:00','visual_required',true),
         1,2,4,3,true,'remediation_pool','ar','dual_term','Q-2026090312'
  where not exists (select 1 from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and position=102);

  -- Options + server-side answer keys + hints + concept links.
  -- Q1
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090301';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','3'),(v_workspace,v_q,2,'B','4'),(v_workspace,v_q,3,'C','5'),(v_workspace,v_q,4,'D','6'),(v_workspace,v_q,5,'E','8')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation,correct_explanation,final_incorrect_explanation)
  values(v_q,v_workspace,'{"option_position":2}'::jsonb,'24 ÷ 6 = 4. عندما نوزّع 24 بالتساوي على 6 مجموعات، يكون في كل مجموعة 4.','ممتاز: كل مجموعة أخذت 4 نجوم.','عدّي عدد العناصر داخل مجموعة واحدة بعد التوزيع بالتساوي.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','جرّبي العد بالقفز: 6، 12، 18، 24. كم قفزة؟','ar','dual_term'),
    (v_workspace,v_q,2,'guide','اسألي نفسك: 6 × كم = 24؟','ar','dual_term'),
    (v_workspace,v_q,3,'strong_guide','6 × 4 = 24، إذن عكس الضرب يعطينا القسمة.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-division-equal-groups';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Q2
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090302';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','7'),(v_workspace,v_q,2,'B','10'),(v_workspace,v_q,3,'C','12'),(v_workspace,v_q,4,'D','14'),(v_workspace,v_q,5,'E','21')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":3}'::jsonb,'لأن 7 × 12 = 84، فالعملية العكسية هي 84 ÷ 7 = 12.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','القسمة والضرب عمليتان عكسيتان.','ar','dual_term'),
    (v_workspace,v_q,2,'guide','استعملي الحقيقة الموجودة في السؤال نفسها: 7 × 12 = 84.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-division-facts';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Q3
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090303';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','03:15'),(v_workspace,v_q,2,'B','03:30'),(v_workspace,v_q,3,'C','06:15'),(v_workspace,v_q,4,'D','06:30'),(v_workspace,v_q,5,'E','02:30')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":2}'::jsonb,'عقرب الدقائق على الرقم 6 يعني 30 دقيقة، وعقرب الساعات بين 3 و4؛ إذن الوقت 03:30.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','ابدئي بعقرب الدقائق الطويل.','ar','dual_term'),
    (v_workspace,v_q,2,'guide','عندما يكون عقرب الدقائق على 6 فهذا يعني نصف ساعة = 30 dakika.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-time-read-clock';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Q4
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090304';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','1 saat 15 dakika'),(v_workspace,v_q,2,'B','1 saat 25 dakika'),(v_workspace,v_q,3,'C','1 saat 35 dakika'),(v_workspace,v_q,4,'D','85 dakika فقط'),(v_workspace,v_q,5,'E','2 saat 25 dakika')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":2}'::jsonb,'من 16:20 إلى 17:20 = ساعة، ثم إلى 17:45 = 25 دقيقة. المجموع 1 ساعة و25 دقيقة.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','قسّمي المدة إلى قفزتين بدل طرح الوقت دفعة واحدة.','ar','dual_term'),
    (v_workspace,v_q,2,'guide','أولًا من 16:20 إلى 17:20، ثم من 17:20 إلى 17:45.','ar','dual_term'),
    (v_workspace,v_q,3,'strong_guide','القفزة الأولى 60 دقيقة والثانية 25 دقيقة. اجمعيهما.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-time-elapsed';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Q5
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090305';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','120 dakika'),(v_workspace,v_q,2,'B','130 dakika'),(v_workspace,v_q,3,'C','150 dakika'),(v_workspace,v_q,4,'D','180 dakika'),(v_workspace,v_q,5,'E','230 dakika')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":3}'::jsonb,'كل ساعة = 60 دقيقة. ساعتان = 120 دقيقة، ومع 30 دقيقة يصبح المجموع 150 دقيقة.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','1 saat = 60 dakika.','ar','dual_term'),
    (v_workspace,v_q,2,'guide','2 saat = 2 × 60 = 120 dakika، ثم أضيفي 30.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-time-convert';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Remediation Q11
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090311';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','3'),(v_workspace,v_q,2,'B','5'),(v_workspace,v_q,3,'C','6'),(v_workspace,v_q,4,'D','9'),(v_workspace,v_q,5,'E','12')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":3}'::jsonb,'18 ÷ 3 = 6. كل صندوق يحصل على 6 كرات.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','اسألي: 3 × كم = 18؟','ar','dual_term'),
    (v_workspace,v_q,2,'guide','3 × 6 = 18.','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-division-equal-groups';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;

  -- Remediation Q12
  select id into v_q from public.quiz_questions where workspace_id=v_workspace and quiz_version_id=v_version and question_code='Q-2026090312';
  insert into public.quiz_question_options(workspace_id,question_id,position,label,content) values
    (v_workspace,v_q,1,'A','35 dakika'),(v_workspace,v_q,2,'B','40 dakika'),(v_workspace,v_q,3,'C','45 dakika'),(v_workspace,v_q,4,'D','50 dakika'),(v_workspace,v_q,5,'E','60 dakika')
  on conflict (question_id,position) do nothing;
  insert into public.quiz_question_answer_keys(question_id,workspace_id,correct_answer,explanation)
  values(v_q,v_workspace,'{"option_position":3}'::jsonb,'من 10:15 إلى 11:00 هناك 45 دقيقة.')
  on conflict (question_id) do update set correct_answer=excluded.correct_answer,explanation=excluded.explanation,updated_at=now();
  insert into public.quiz_question_hints(workspace_id,question_id,hint_level,pedagogical_role,content,language,terminology_display_mode) values
    (v_workspace,v_q,1,'nudge','من الدقيقة 15 حتى الدقيقة 60، كم دقيقة؟','ar','dual_term'),
    (v_workspace,v_q,2,'guide','60 - 15 = ؟','ar','dual_term')
  on conflict (question_id,hint_level) do nothing;
  select id into v_concept from public.learning_concepts where workspace_id=v_workspace and code='tr-g4-time-elapsed';
  insert into public.quiz_question_concepts(workspace_id,question_id,concept_id,is_primary,weight) values(v_workspace,v_q,v_concept,true,1) on conflict do nothing;
end $$;
