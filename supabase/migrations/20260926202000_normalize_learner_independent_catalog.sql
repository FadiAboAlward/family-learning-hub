-- FLH-FEAT-2026-006 v1.0
-- SPEC_REVISION_ID: ANLCKQklYVbefbCW6URP9IKRimcZ-hAqhqsNqnHJYMJpXhBY71H5l3LICz1imueDFNY2oyGwc2zifPZ_iib-e0Ck4LQoHzYD202eA_oVnKw
-- MIGRATION_IDENTITY: 20260926202000_normalize_learner_independent_catalog.sql
-- Forward-only normalization of learner-independent catalog/configuration rows.
-- Historical migrations remain immutable.

do $migration$
declare
  v_workspace uuid;
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

  update public.quiz_versions qv
  set instructions = case q.slug
    when 'sy-g7-integers-add-subtract-v1' then
      'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الأعداد الصحيحة 🔢 الجمع والطرح | الدرس2️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025-2026». في وضع التعلّم استخدم التلميحات وتعلّم من الخطأ. بعد الانتهاء افتح Exam Mode؛ لن يظهر لك التصحيح أثناء الامتحان، وستظهر النتيجة بعد التسليم.'
    when 'sy-g7-integers-multiply-divide-v1' then
      'قبل أن تبدأ Learning Mode تأكد أنك شاهدت فيديو «الاعداد الصحيحة ✖️➗ الضرب والقسمة | الدرس 3️⃣ | رياضيات جبر الصف السابع المنهاج السوري 2025 -2026». تعلّم قاعدة الإشارات من كل سؤال، وبعدها افتح Exam Mode. في الامتحان لا توجد تلميحات ولا يظهر التصحيح قبل التسليم.'
    else qv.instructions
  end
  from public.quizzes q
  where qv.quiz_id = q.id
    and qv.workspace_id = v_workspace
    and q.workspace_id = v_workspace
    and qv.version_no = 1
    and q.slug in (
      'sy-g7-integers-add-subtract-v1',
      'sy-g7-integers-multiply-divide-v1'
    );
end
$migration$;
