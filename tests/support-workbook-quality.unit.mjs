import assert from 'node:assert/strict';
import { validateSupportWorkbookPackage } from '../scripts/support-workbook-quality.mjs';

const longHint=(n)=>[
  '• المستوى '+n+': ابدأ بتحديد التمثيل المطلوب واقرأ القيم والرموز كما هي، ثم دوّن العلاقة الرياضية الأساسية قبل أي تحويل حتى لا تختلط عليك المقامات أو المنازل العشرية أثناء الحل.',
  '• المستوى '+n+': حوّل القيم إلى تمثيل مشترك خطوة خطوة، واحتفظ بكل خطوة مكتوبة بوضوح حتى تستطيع مراجعة المنطق ومقارنة النتائج من دون القفز مباشرة إلى الجواب النهائي.',
  '• المستوى '+n+': راجع النتيجة باستخدام تمثيل ثانٍ أو تقدير عددي مناسب، وتأكد أن ترتيب القيم واتجاه المقارنة ووحدة القياس بقيت صحيحة قبل تثبيت اختيارك النهائي.'
].join('\n');

function basePackage(){
  return {
    package_type:'support_workbook',
    runtime_external_dependencies:[],
    source:{code:'TEST',title:'Test support pack',publisher:'MEB',official:true,pdf_pages:5,math_mode:'VISUAL_AUTHORITATIVE'},
    units:[{key:'u1',title:'Unit 1',outcome:'MAT.TEST'}],
    hint_profiles:{compare:[longHint(1),longHint(2),longHint(3),longHint(4)]},
    sessions:[{
      slug:'s1',unit:'u1',title:'Session 1',pages:[2],
      questions:[{
        question_code:'Q-1',type:'single_choice',prompt:'2/5 ile 3/5 karşılaştırıldığında hangisi daha büyüktür?',
        prompt_language:'tr',decomposable:false,
        pdf_page:2,hint_profile:'compare',answer:{option_position:2},options:['2/5','3/5'],
        grading_mode:'graded',points:1,origin:'book_exact',difficulty:2,
        explanation_ar:'لأن المقامين متساويان نقارن البسطين، و3 أكبر من 2؛ لذلك 3/5 هو الكسر الأكبر.',
        source_note:null
      }]
    }]
  };
}
const codes=result=>new Set(result.errors.map(e=>e.code));

{
  const pkg=basePackage();
  pkg.hint_profiles.compare[0]=[
    '• الإجابة الصحيحة هي 3/5؛ سجّلها مباشرة في السؤال ولا تحتاج إلى أي تحويل أو مقارنة إضافية بين القيم المعطاة في هذا التمرين الآن.',
    '• هذا السطر يضيف كلمات تعليمية كثيرة فقط حتى يظل الاختبار يركز على تسريب الجواب النهائي بدل أن يفشل بسبب شرط طول التلميح في البوابة.',
    '• راجع أن القيمة المذكورة هي نفسها الاختيار الصحيح ثم ثبّت الإجابة، فهذا الاختبار المتعمد يجب أن يلتقط كشف الجواب للطالب قبل الحل.'
  ].join('\n');
  assert(codes(validateSupportWorkbookPackage(pkg)).has('HINT_ANSWER_LEAK'),'hint answer leak must fail');
}
{
  const pkg=basePackage();
  const q=pkg.sessions[0].questions[0];
  q.grading_mode='ungraded'; q.points=0;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('UNGRADED_ANSWER_KEY_FORBIDDEN'),'ungraded item with answer key must fail');
}
{
  const pkg=basePackage();
  pkg.sessions[0].questions[0].pdf_page=3;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('SOURCE_PAGE_OUTSIDE_SESSION'),'question page outside its session must fail');
}
{
  const pkg=basePackage();
  pkg.sessions[0].questions[0].answer.option_position=3;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('SINGLE_CHOICE_ANSWER_INVALID'),'invalid option_position must fail');
}
{
  const pkg=basePackage();
  pkg.sessions[0].questions[0].explanation_ar='This is not Arabic learner feedback.';
  assert(codes(validateSupportWorkbookPackage(pkg)).has('ARABIC_FEEDBACK_REQUIRED'),'non-Arabic explanation_ar must fail');
}
{
  const pkg=basePackage();
  delete pkg.sessions[0].questions[0].prompt_language;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('PROMPT_LANGUAGE_REQUIRED'),'missing prompt_language must fail');
}
{
  const pkg=basePackage();
  delete pkg.sessions[0].questions[0].decomposable;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('DECOMPOSABLE_CLASSIFICATION_REQUIRED'),'missing decomposable classification must fail');
}
{
  const pkg=basePackage();
  pkg.sessions[0].questions[0].decomposable=true;
  assert(codes(validateSupportWorkbookPackage(pkg)).has('DECOMPOSITION_PROFILE_REQUIRED'),'decomposable question without 3/6 profile must fail');
}
{
  const pkg=basePackage();
  pkg.sessions[0].questions[0].prompt='\\frac{2}{5}=\\frac{4}{10} ilişkisini değerlendiriniz.';
  pkg.sessions[0].questions[0].explanation_ar='نحتاج للانتقال من 19 إلى 60 إلى 41 خلية؛ الأرقام تفصل الكلمات المتكررة دلاليًا.';
  const result=validateSupportWorkbookPackage(pkg);
  assert(!codes(result).has('ADJACENT_DUPLICATE_WORD'),JSON.stringify(result.errors,null,2));
}
{
  const result=validateSupportWorkbookPackage(basePackage());
  assert.equal(result.ok,true,JSON.stringify(result.errors,null,2));
}
console.log('Support workbook validator unit tests passed.');
