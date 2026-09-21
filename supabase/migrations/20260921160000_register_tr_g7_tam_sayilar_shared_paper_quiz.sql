-- FLH-CONTENT-2026-003 / Spec v1.0
-- Register Mohammad's approved Turkish Grade 7 Tam Sayılar paper as one
-- immutable canonical quiz version shared by Learning Mode, Exam Mode, and
-- paper ingestion. The paper is an alternate delivery surface, not a third
-- question set.
do $migration$
declare
  v_workspace uuid;
  v_curriculum uuid;
  v_curriculum_subject uuid;
  v_math bigint;
  v_mohammad uuid;
  v_program uuid;
  v_program_subject uuid;
  v_book uuid;
  v_unit uuid;
  v_quiz uuid;
  v_version uuid;
  v_question uuid;
  v_concept uuid;
  v_question_code text;
  v_model_code text := 'MOH-TRMATH7-K1-TAM-PAPER-20260921-B';
  v_quiz_slug text := 'tr-g7-tam-sayilar-20260921-b';
  v_map jsonb := '{}'::jsonb;
  v_canonical jsonb;
  v_hash text;
  v_row jsonb;
  v_option text;
  v_n integer;
  v_pos integer;
  v_package jsonb := $json$
[
 {
  "n": 1,
  "prompt": "Bir ölçekte 0 sayısı “başlangıç/referans noktası” olarak kullanılıyor. Aşağıdakilerden hangisi buna en uygun örnektir?",
  "options": [
   "Telefon paketinde 0 MB kalması",
   "Bir yarışın başlangıç çizgisi",
   "Kutuda 0 kalem bulunması",
   "Cüzdanda 0 TL olması"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-zero-reference"
 },
 {
  "n": 2,
  "prompt": "Aşağıdakilerden hangisinin doğal bir başlangıç noktası vardır?",
  "options": [
   "Sıcaklık",
   "Kütle",
   "Tarih şeridi",
   "Deniz seviyesine göre yükseklik"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-zero-reference"
 },
 {
  "n": 3,
  "prompt": "Tam sayılar kümesi hangilerinden oluşur?",
  "options": [
   "Sadece pozitif sayılardan",
   "Negatif tam sayılar, 0 ve pozitif tam sayılardan",
   "Sadece doğal sayılardan",
   "Kesirlerden ve doğal sayılardan"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-sign-set"
 },
 {
  "n": 4,
  "prompt": "Deniz seviyesinin 18 m üstü hangi tam sayı ile gösterilir?",
  "options": [
   "-18",
   "+18",
   "0",
   "+1"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-real-life-modeling"
 },
 {
  "n": 5,
  "prompt": "0 sayısı için hangisi doğrudur?",
  "options": [
   "Pozitiftir.",
   "Negatiftir.",
   "Ne pozitif ne negatiftir.",
   "Hem pozitif hem negatiftir."
  ],
  "correct": 3,
  "concept": "tr-g7-integers-sign-set"
 },
 {
  "n": 6,
  "prompt": "Bu kitaptaki tanıma göre aşağıdakilerden hangisi doğal sayıdır?",
  "options": [
   "-3",
   "-1",
   "0",
   "-8"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-sign-set"
 },
 {
  "n": 7,
  "prompt": "Aşağıdaki karşılaştırmalardan hangisi doğrudur?",
  "options": [
   "-8 > -3",
   "-2 < -7",
   "-4 < +1",
   "0 < -5"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 8,
  "prompt": "-4, +5, -1, 0 sayılarının küçükten büyüğe sıralanışı hangisidir?",
  "options": [
   "-4, -1, 0, +5",
   "+5, 0, -1, -4",
   "-1, -4, 0, +5",
   "-4, 0, -1, +5"
  ],
  "correct": 1,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 9,
  "prompt": "Sayı doğrusunda -6 ile +2 arasındaki uzaklık kaç birimdir?",
  "options": [
   "4",
   "6",
   "8",
   "10"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 10,
  "prompt": "-3 noktasından 5 birim sağa gidilirse hangi sayıya ulaşılır?",
  "options": [
   "-8",
   "-2",
   "+2",
   "+8"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 11,
  "prompt": "Bir dalgıç deniz seviyesinin 14 m altındadır. Konumu hangisidir?",
  "options": [
   "+14",
   "-14",
   "0",
   "-1"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-real-life-modeling"
 },
 {
  "n": 12,
  "prompt": "Sıcaklık -6 °C iken +1 °C oluyor. İki sıcaklık arasındaki fark kaç derecedir?",
  "options": [
   "5",
   "6",
   "7",
   "8"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 13,
  "prompt": "Bir kişinin hesabında 40 TL borç vardır. Bakiye hangi tam sayı ile gösterilir?",
  "options": [
   "+40",
   "-40",
   "0",
   "+4"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-real-life-modeling"
 },
 {
  "n": 14,
  "prompt": "Zemin kat 0’dır. Otopark -2. kattadır. Otoparkın 3 kat üstü hangi kattır?",
  "options": [
   "-5",
   "-1",
   "+1",
   "+5"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-real-life-modeling"
 },
 {
  "n": 15,
  "prompt": "Aralarında 5 birim uzaklık bulunan biri negatif biri pozitif iki tam sayı çifti hangisidir?",
  "options": [
   "-2 ve +3",
   "-4 ve +4",
   "-5 ve 0",
   "-1 ve +1"
  ],
  "correct": 1,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 16,
  "prompt": "-3 sayısına 4 birim uzaklıkta bulunan iki tam sayı hangileridir?",
  "options": [
   "-7 ve +1",
   "-6 ve +2",
   "-5 ve +3",
   "-4 ve +4"
  ],
  "correct": 1,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 17,
  "prompt": "Bir çekirge -4’ten +8’e 6 eşit sıçrayışla gidiyor. Her sıçrayış kaç birimdir?",
  "options": [
   "1",
   "2",
   "3",
   "4"
  ],
  "correct": 2,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 18,
  "prompt": "Bir şehirde sıcaklık +3 °C’den -5 °C’ye düştü. Kaç derece azaldı?",
  "options": [
   "2",
   "5",
   "8",
   "9"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-number-line-order-distance"
 },
 {
  "n": 19,
  "prompt": "Aşağıdaki durumlardan hangisi negatif tam sayı ile gösterilmelidir?",
  "options": [
   "Deniz seviyesinin 6 m üstü",
   "20 TL kâr",
   "Zemin katın 3 kat altı",
   "0 °C sıcaklık"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-real-life-modeling"
 },
 {
  "n": 20,
  "prompt": "Zemin kat 0. Sığınak -1. katta, Asya sığınağın 3 kat üstünde, Demir Asya’nın 2 kat üstünde oturuyor. Demir hangi kattadır?",
  "options": [
   "0",
   "+2",
   "+4",
   "+5"
  ],
  "correct": 3,
  "concept": "tr-g7-integers-real-life-modeling"
 }
]
$json$::jsonb;
begin
  select id into v_workspace from public.workspaces where slug='family-learning-hub' limit 1;
  select id into v_curriculum from public.curricula where code='turkiye-meb' and is_active limit 1;
  select id into v_math from public.subjects where code='math' limit 1;
  select id into v_mohammad
    from public.learners
    where workspace_id=v_workspace and slug='mohammad' and is_active
    limit 1;

  if v_workspace is null or v_curriculum is null or v_math is null then
    raise exception 'TR_G7_TAM_SAYILAR_PREREQUISITES_MISSING';
  end if;

  if exists (
    select 1 from public.quiz_versions
    where workspace_id=v_workspace
      and settings->'paper_exam'->>'paper_model_code'=v_model_code
  ) then
    raise exception 'paper model already registered: %',v_model_code;
  end if;

  select id into v_curriculum_subject
  from public.curriculum_subjects
  where curriculum_id=v_curriculum
    and subject_id=v_math
    and grade_level=7
    and school_year='2026-2027'
  limit 1;

  if v_curriculum_subject is null then
    insert into public.curriculum_subjects(
      curriculum_id,subject_id,grade_level,school_year,display_name,sort_order,metadata
    ) values (
      v_curriculum,v_math,7,'2026-2027','Matematik — 7. Sınıf',1,
      jsonb_build_object('model','Türkiye Yüzyılı Maarif Modeli')
    ) returning id into v_curriculum_subject;
  end if;

  select id into v_program
  from public.learning_programs
  where workspace_id=v_workspace and slug='tr-g7-2026-2027'
  limit 1;

  if v_program is null then
    insert into public.learning_programs(
      workspace_id,slug,code,title,description,program_type,curriculum_id,
      grade_level,school_year,primary_language,status,metadata
    ) values (
      v_workspace,'tr-g7-2026-2027','TR-G7-2026-2027',
      'المنهاج التركي — الصف السابع — 2026–2027',
      'برنامج الصف السابع وفق منهج MEB التركي للعام 2026–2027.',
      'curriculum',v_curriculum,7,'2026-2027','tr','active',
      jsonb_build_object('created_reason','Turkish Grade 7 active curriculum')
    ) returning id into v_program;
  end if;

  select id into v_program_subject
  from public.program_subjects
  where workspace_id=v_workspace and program_id=v_program and subject_id=v_math
  limit 1;

  if v_program_subject is null then
    insert into public.program_subjects(
      workspace_id,program_id,subject_id,curriculum_subject_id,display_name,sort_order,metadata
    ) values (
      v_workspace,v_program,v_math,v_curriculum_subject,'Matematik',1,
      jsonb_build_object('language','tr')
    ) returning id into v_program_subject;
  end if;

  select id into v_book
  from public.books
  where code='TR-MATH-G7-2026-2027-K1'
    and curriculum_id=v_curriculum
    and subject_id=v_math
  limit 1;

  if v_book is null then
    insert into public.books(
      subject_id,code,title,grade_level,school_year,language,pdf_pages,
      source_metadata,curriculum_id,source_kind
    ) values (
      v_math,'TR-MATH-G7-2026-2027-K1','Matematik 7. Sınıf Ders Kitabı — 1. Kitap',
      7,'2026-2027','tr',224,
      jsonb_build_object(
        'book_part','K1',
        'source_pdf','matematik7-1.pdf',
        'parent_book_code','TR-MATH-G7-2026-2027',
        'edition_note','MEB approval 01.07.2026 / 163494731; Family Learning Hub usage year 2026-2027',
        'isbn','978-975-11-9899-0',
        'visual_book_url','https://docs.google.com/presentation/d/1Ex09RxITfZh0PmtfBF7pcZN8mgGykouK6-LwKbyDV3Q/edit',
        'visual_page_mapping','PDF page = slide 1:1',
        'math_source_of_truth','visual'
      ),
      v_curriculum,'textbook'
    ) returning id into v_book;
  end if;

  if not exists (
    select 1 from public.program_books
    where workspace_id=v_workspace and program_id=v_program and book_id=v_book
  ) then
    insert into public.program_books(
      workspace_id,program_id,book_id,program_subject_id,is_required,sort_order,metadata
    ) values (
      v_workspace,v_program,v_book,v_program_subject,true,1,
      jsonb_build_object('book_part','K1')
    );
  end if;

  select id into v_unit
  from public.units
  where book_id=v_book and slug='tema-1-sayilar-ve-nicelikler-1'
  limit 1;

  if v_unit is null then
    insert into public.units(book_id,slug,title,sort_order,metadata)
    values(
      v_book,'tema-1-sayilar-ve-nicelikler-1','1. Tema — Sayılar ve Nicelikler (1)',1,
      jsonb_build_object('pdf_page_start',13,'pdf_page_end',116,'book_part','K1')
    ) returning id into v_unit;
  end if;

  insert into public.learning_concepts(
    workspace_id,subject_id,curriculum_id,code,title,grade_level,metadata
  )
  select v_workspace,v_math,v_curriculum,x.code,x.title,7,x.metadata
  from (
    values
      ('tr-g7-integers-zero-reference',
       'Sıfır ve başlangıç/referans noktası',
       '{"domain":"tam_sayilar","pages":[19,20],"book_code":"TR-MATH-G7-2026-2027","book_part":"K1"}'::jsonb),
      ('tr-g7-integers-sign-set',
       'Tam sayılar, pozitif/negatif sayılar ve doğal sayılar',
       '{"domain":"tam_sayilar","pages":[19,20],"book_code":"TR-MATH-G7-2026-2027","book_part":"K1"}'::jsonb),
      ('tr-g7-integers-number-line-order-distance',
       'Sayı doğrusu, sıralama ve uzaklık',
       '{"domain":"tam_sayilar","pages":[20,21,22,23],"book_code":"TR-MATH-G7-2026-2027","book_part":"K1"}'::jsonb),
      ('tr-g7-integers-real-life-modeling',
       'Tam sayılarla günlük yaşam durumlarını modelleme',
       '{"domain":"tam_sayilar","pages":[20,21,22,23],"book_code":"TR-MATH-G7-2026-2027","book_part":"K1"}'::jsonb)
  ) as x(code,title,metadata)
  where not exists (
    select 1 from public.learning_concepts c
    where c.workspace_id=v_workspace and c.code=x.code
  );

  if exists (
    select 1 from public.quizzes
    where workspace_id=v_workspace and slug=v_quiz_slug
  ) then
    raise exception 'quiz slug already exists without paper binding: %',v_quiz_slug;
  end if;

  insert into public.quizzes(
    workspace_id,subject_id,book_id,slug,title,description,status,curriculum_id,
    unit_id,quiz_kind,delivery_config
  ) values (
    v_workspace,v_math,v_book,v_quiz_slug,
    'Matematik 7 — Tam Sayılar — 20 Soru',
    'Learning Mode, Exam Mode ve onaylı iki sayfalık kağıt sınav için aynı 20 soruluk sabit set.',
    'active',v_curriculum,v_unit,'review',
    jsonb_build_object(
      'learning',jsonb_build_object(
        'hints',true,'retry',true,'instant_feedback',true,'question_count',20
      ),
      'exam',jsonb_build_object(
        'hints',false,'retry',false,'question_count',20,
        'instant_feedback',false,'show_results_after_submit',true
      )
    )
  ) returning id into v_quiz;

  insert into public.quiz_versions(
    workspace_id,quiz_id,version_no,state,instructions,settings,published_at,
    question_language,explanation_language,terminology_display_mode
  ) values (
    v_workspace,v_quiz,1,'published',
    'Learning Mode ve Exam Mode aynı 20 soruyu kullanır. Kağıt sürümü de bu değişmez quiz version ile birebir aynıdır.',
    '{}'::jsonb,now(),'tr','ar','dual_term'
  ) returning id into v_version;

  for v_row in select value from jsonb_array_elements(v_package) loop
    v_n := (v_row->>'n')::integer;
    v_question := gen_random_uuid();
    v_question_code := 'Q-' || (20260921000 + v_n)::text;

    select id into v_concept
    from public.learning_concepts
    where workspace_id=v_workspace and code=v_row->>'concept'
    limit 1;

    if v_concept is null then
      raise exception 'concept missing for paper question %: %',v_n,v_row->>'concept';
    end if;

    insert into public.quiz_questions(
      id,workspace_id,quiz_version_id,position,question_type,prompt,origin,
      source_page_start,source_page_end,source_metadata,points,
      difficulty_level,max_attempts,remediation_after_attempt,adaptive_enabled,
      delivery_role,prompt_language,terminology_display_mode,question_code
    ) values (
      v_question,v_workspace,v_version,v_n,'single_choice',v_row->>'prompt','generated',
      19,23,
      jsonb_build_object(
        'paper_model_code',v_model_code,
        'source_book_code','TR-MATH-G7-2026-2027',
        'source_book_part','K1',
        'source_pdf_pages',jsonb_build_array(19,20,21,22,23),
        'origin_label','GENERATED_SIMILAR',
        'source_verified','AI-READY Markdown / MEB Tam Sayılar scope',
        'math_storage_direction','logical_ltr'
      ),
      1,2,4,2,false,'core','tr','source_only',v_question_code
    );

    v_pos := 0;
    for v_option in select jsonb_array_elements_text(v_row->'options') loop
      v_pos := v_pos + 1;
      insert into public.quiz_question_options(
        workspace_id,question_id,position,label,content
      ) values (v_workspace,v_question,v_pos,chr(64+v_pos),v_option);
    end loop;

    insert into public.quiz_question_answer_keys(
      question_id,workspace_id,correct_answer,explanation,grading_config,
      correct_explanation,final_incorrect_explanation
    ) values (
      v_question,v_workspace,
      jsonb_build_object('option_position',(v_row->>'correct')::integer),
      'راجع مفهوم Tam Sayılar وخط الأعداد لتأكيد النتيجة.',
      '{}'::jsonb,
      'إجابة صحيحة.',
      'راجع الإشارة وخط الأعداد أو معنى الحالة الحياتية ثم أعد المحاولة.'
    );

    insert into public.quiz_question_hints(
      workspace_id,question_id,hint_level,pedagogical_role,content,metadata,
      language,terminology_display_mode
    ) values
      (v_workspace,v_question,1,'nudge',
       'حدّد أولاً معنى الإشارة أو موقع العدد بالنسبة إلى 0.',
       '{}'::jsonb,'ar','dual_term'),
      (v_workspace,v_question,2,'guide',
       'استخدم خط الأعداد: اليمين أكبر، اليسار أصغر، والمسافة تُحسب بعدد الوحدات.',
       '{}'::jsonb,'ar','dual_term');

    insert into public.quiz_question_concepts(
      workspace_id,question_id,concept_id,is_primary,weight
    ) values (v_workspace,v_question,v_concept,true,1);

    v_map := v_map || jsonb_build_object(
      v_n::text,
      jsonb_build_object(
        'question_id',v_question,
        'question_code',v_question_code,
        'option_positions',jsonb_build_object('A',1,'B',2,'C',3,'D',4)
      )
    );
  end loop;

  if not exists (
    select 1 from public.program_quizzes
    where workspace_id=v_workspace and program_id=v_program and quiz_id=v_quiz
  ) then
    insert into public.program_quizzes(
      workspace_id,program_id,quiz_id,program_subject_id,availability,sort_order,metadata
    ) values (
      v_workspace,v_program,v_quiz,v_program_subject,'available',1,
      jsonb_build_object('scope','Tam Sayılar','paper_model_code',v_model_code)
    );
  end if;

  -- Fresh database QA intentionally contains no real Mohammad/Aya learner.
  -- Enrollment is therefore conditional: Production adds Mohammad as a
  -- secondary program only when his real learner row already exists.
  if v_mohammad is not null and not exists (
    select 1 from public.learner_program_enrollments
    where workspace_id=v_workspace and learner_id=v_mohammad and program_id=v_program
  ) then
    insert into public.learner_program_enrollments(
      workspace_id,learner_id,program_id,status,is_primary,started_at,metadata
    ) values (
      v_workspace,v_mohammad,v_program,'active',false,now(),
      jsonb_build_object(
        'reason','Mohammad Turkish Grade 7 school curriculum',
        'added_for_quiz',v_quiz_slug
      )
    );
  end if;

  update public.quiz_versions
  set settings=jsonb_build_object(
    'paper_exam',jsonb_build_object(
      'paper_model_code',v_model_code,
      'paper_page_count',2,
      'paper_question_count',20,
      'paper_question_map',v_map,
      'paper_hash_algorithm','sha256',
      'paper_hash_basis','canonical-runtime-package-v1',
      'source_book_code','TR-MATH-G7-2026-2027',
      'source_book_part','K1',
      'source_pdf_pages',jsonb_build_array(19,20,21,22,23),
      'approved_artifact','Mohammad_TR_Math_G7_Paper_20Q_BW_REVIEW.pdf',
      'approved_at',now(),
      'approval_note','Parent approved the exact black-and-white two-page model before backend publication.',
      'layout',jsonb_build_object(
        'page_size','A4','orientation','portrait','columns_per_page',2,
        'direction','ltr','print_mode','black_and_white'
      ),
      'math_storage_direction','logical_ltr',
      'shared_delivery_invariant','learning_exam_paper_same_question_set'
    )
  )
  where workspace_id=v_workspace and id=v_version;

  v_canonical := public.flh_paper_exam_runtime_package(v_workspace,v_version);
  if v_canonical is null or jsonb_array_length(v_canonical) <> 20 then
    raise exception 'canonical paper package could not be rebuilt';
  end if;

  v_hash := encode(
    extensions.digest(convert_to(v_canonical::text,'UTF8'),'sha256'),
    'hex'
  );

  update public.quiz_versions
  set settings=jsonb_set(
    jsonb_set(
      jsonb_set(
        settings,
        '{paper_exam,paper_canonical_package}',
        v_canonical,
        true
      ),
      '{paper_exam,paper_content_hash}',
      to_jsonb(v_hash),
      true
    ),
    '{paper_exam,paper_runtime_content_hash}',
    to_jsonb(v_hash),
    true
  )
  where workspace_id=v_workspace and id=v_version;
end;
$migration$;
