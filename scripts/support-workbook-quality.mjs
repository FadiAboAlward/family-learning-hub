const clean = v => typeof v === 'string' ? v.replace(/\p{Cf}/gu,'').trim() : '';
const words = v => clean(v).replace(/^•\s*/gmu,'').match(/[\p{L}\p{M}\p{N}]+(?:['’ʼ-][\p{L}\p{M}\p{N}]+)*/gu) || [];
const bullets = v => clean(v).split(/\r?\n/u).map(x=>x.trim()).filter(Boolean);
const markup = /&(?:#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);|<\/?[a-z][^>]*>/iu;
const external = /(?:kitab[ıiuü]|sayfa(?:ya|da)|kayna(?:ğa|kta)|افتح\s+(?:الكتاب|الصفحة)|راجع\s+(?:الكتاب|الصفحة)|look\s+at\s+(?:the\s+)?(?:book|page)|open\s+(?:the\s+)?(?:book|page))/iu;

function push(list,code,path,message){list.push({code,path,message});}
function visibleTextChecks(errors,path,value,{selfContained=true,arabic=false,duplicate=true}={}){
  const t=clean(value);
  if(!t)return;
  if(markup.test(t))push(errors,'LEARNER_TEXT_MARKUP_FORBIDDEN',path,'Learner-visible text must be plain text.');
  if(selfContained&&external.test(t))push(errors,'EXTERNAL_SOURCE_DEPENDENCY',path,'Learner-visible text must be self-contained.');
  const lexical=duplicate?(t.match(/[\p{L}\p{M}]+|\p{N}+(?:[.,]\p{N}+)*/gu)||[]):[];
  const repeated=lexical.find((token,i)=>i>0&&/\p{L}/u.test(token)&&/\p{L}/u.test(lexical[i-1])&&token.length>1&&token.toLocaleLowerCase('und')===lexical[i-1].toLocaleLowerCase('und'));
  if(repeated)push(errors,'ADJACENT_DUPLICATE_WORD',path,'Learner-visible text repeats an adjacent word.');
  if(arabic&&!/[\u0600-\u06FF]/u.test(t))push(errors,'ARABIC_FEEDBACK_REQUIRED',path,'Arabic feedback must contain Arabic-script learner text.');
}
function answerCandidates(q){
  if(!q||q.grading_mode==='ungraded'||!q.answer)return[];
  if(q.type==='single_choice'){
    const pos=Number(q.answer.option_position);
    return Array.isArray(q.options)&&pos>0&&pos<=q.options.length?[clean(q.options[pos-1])]:[];
  }
  if(q.type==='numeric')return clean(q.answer.value)?[clean(q.answer.value)]:[];
  if(q.type==='short_answer'){
    const xs=Array.isArray(q.answer.accepted_text)?q.answer.accepted_text.map(clean).filter(Boolean):[];
    return xs.length?xs:(clean(q.answer.value)?[clean(q.answer.value)]:[]);
  }
  return[];
}
function normalized(v){return clean(v).toLocaleLowerCase('und').replace(/[−–—]/gu,'-').replace(/[٫,]/gu,'.').replace(/\s+/gu,'');}
function hintLeaks(hint,candidate){
  const rawH=clean(hint).toLocaleLowerCase('und').replace(/[−–—]/gu,'-').replace(/[٫,]/gu,'.');
  const rawA=clean(candidate).toLocaleLowerCase('und').replace(/[−–—]/gu,'-').replace(/[٫,]/gu,'.');
  if(!rawA)return false;
  if(rawA.length===1){
    if(/[\p{L}\p{N}]/u.test(rawA)){
      return (rawH.match(/[\p{L}\p{M}\p{N}]+/gu)||[]).some(token=>token===rawA);
    }
    return rawH.includes(rawA);
  }
  if(/[0-9٠-٩%/.,<>=+*−-]/u.test(rawA))return normalized(hint).includes(normalized(candidate));
  const phrase=rawA.trim().replace(/\s+/gu,' ');
  const escaped=phrase.replace(/[.*+?^$()|[\]{}\\]/g,'\\function hintLeaks(hint,candidate){
  const rawH=clean(hint).toLocaleLowerCase('und').replace(/[−–—]/gu,'-').replace(/[٫,]/gu,'.');
  const rawA=clean(candidate).toLocaleLowerCase('und').replace(/[−–—]/gu,'-').replace(/[٫,]/gu,'.');
  if(!rawA)return false;
  if(rawA.length===1){
    if(/[\p{L}\p{N}]/u.test(rawA)){
      return (rawH.match(/[\p{L}\p{M}\p{N}]+/gu)||[]).some(token=>token===rawA);
    }
    return rawH.includes(rawA);
  }
  const h=normalized(hint),a=normalized(candidate);
  if(/[0-9٠-٩%/.,<>=+*−-]/u.test(a))return h.includes(a);
  const escaped=a.replace(/[.*+?^$()|[\]{}\\]/g,'\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'([^\\p{L}\\p{N}]|$)','u').test(h);
}').replace(/\ /g,'\\s+');
  return new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'([^\\p{L}\\p{N}]|$)','u').test(rawH);
}

export function validateSupportWorkbookPackage(pkg){
  const errors=[],warnings=[];
  const source=pkg?.source||{}, units=Array.isArray(pkg?.units)?pkg.units:[], sessions=Array.isArray(pkg?.sessions)?pkg.sessions:[], profiles=pkg?.hint_profiles||{}, decomposition=pkg?.hint_decomposition||{};
  const unitKeys=new Set(), sessionSlugs=new Set(), questionCodes=new Set();
  if(pkg?.package_type!=='support_workbook')push(errors,'SUPPORT_PACKAGE_TYPE_REQUIRED','package_type','Expected support_workbook.');
  if(!Array.isArray(pkg?.runtime_external_dependencies))push(errors,'RUNTIME_EXTERNAL_DEPENDENCIES_REQUIRED','runtime_external_dependencies','Declare runtime dependencies explicitly.');
  else if(pkg.runtime_external_dependencies.length)push(errors,'EXTERNAL_RUNTIME_DEPENDENCY_FORBIDDEN','runtime_external_dependencies','External runtime dependencies are forbidden.');
  if(!clean(source.code)||!clean(source.title))push(errors,'SUPPORT_SOURCE_IDENTITY_REQUIRED','source','Source code and title are required.');
  if(source.publisher!=='MEB'||source.official!==true)push(errors,'SUPPORT_SOURCE_OFFICIAL_MEB_REQUIRED','source','Verified MEB provenance is required.');
  if(source.math_mode!=='VISUAL_AUTHORITATIVE')push(errors,'SUPPORT_MATH_VISUAL_AUTHORITY_REQUIRED','source.math_mode','Math support source must remain VISUAL_AUTHORITATIVE.');
  if(!Number.isInteger(source.pdf_pages)||source.pdf_pages<1)push(errors,'SUPPORT_SOURCE_PDF_PAGES_INVALID','source.pdf_pages','pdf_pages must be positive.');

  for(const [i,u] of units.entries()){
    const p='units['+i+']',key=clean(u?.key);
    if(!key)push(errors,'SUPPORT_UNIT_KEY_REQUIRED',p+'.key','Unit key is required.');
    else if(unitKeys.has(key))push(errors,'SUPPORT_UNIT_DUPLICATE',p+'.key','Unit key must be unique.');
    else unitKeys.add(key);
    if(!clean(u?.title)||!clean(u?.outcome))push(errors,'SUPPORT_UNIT_METADATA_REQUIRED',p,'Unit title and official outcome are required.');
  }

  for(const [name,raw] of Object.entries(profiles)){
    const hs=Array.isArray(raw)?raw:[],seen=new Set();
    if(hs.length!==4)push(errors,'FOUR_HINT_LEVELS_REQUIRED','hint_profiles.'+name,'Exactly four progressive hints are required.');
    hs.forEach((h,i)=>{
      const p='hint_profiles.'+name+'['+i+']',t=clean(h);
      if(words(t).length<30)push(errors,'HINT_MIN_WORDS',p,'Hint must contain at least 30 lexical words.');
      const lines=bullets(t);
      if(lines.length!==3||lines.some(x=>!/^•\s+\S/u.test(x)))push(errors,'HINT_BULLET_STRUCTURE',p,'Hint must contain exactly three bullet lines.');
      const key=normalized(t);
      if(seen.has(key))push(errors,'DUPLICATE_HINT_CONTENT',p,'Hint duplicates an earlier level.');
      seen.add(key);
      if(markup.test(t)||external.test(t))push(errors,'HINT_NOT_SELF_CONTAINED',p,'Hint must be plain and self-contained.');
    });
  }

  if(!sessions.length)push(errors,'SUPPORT_SESSIONS_REQUIRED','sessions','At least one session is required.');
  sessions.forEach((session,si)=>{
    const sp='sessions['+si+']',slug=clean(session?.slug),pages=Array.isArray(session?.pages)?session.pages:[],qs=Array.isArray(session?.questions)?session.questions:[];
    if(!slug)push(errors,'SUPPORT_SESSION_SLUG_REQUIRED',sp+'.slug','Session slug is required.');
    else if(sessionSlugs.has(slug))push(errors,'SUPPORT_SESSION_SLUG_DUPLICATE',sp+'.slug','Session slug must be unique.');
    else sessionSlugs.add(slug);
    if(!unitKeys.has(clean(session?.unit)))push(errors,'SUPPORT_SESSION_UNIT_UNKNOWN',sp+'.unit','Session unit is not declared.');
    if(!clean(session?.title))push(errors,'SUPPORT_SESSION_TITLE_REQUIRED',sp+'.title','Session title is required.');
    if(!pages.length||pages.some(x=>!Number.isInteger(x)||x<1||x>source.pdf_pages))push(errors,'SUPPORT_SESSION_PAGES_INVALID',sp+'.pages','Invalid original PDF page set.');
    if(!qs.length)push(errors,'SUPPORT_SESSION_QUESTIONS_REQUIRED',sp+'.questions','Session needs questions.');

    qs.forEach((q,qi)=>{
      const qp=sp+'.questions['+qi+']',code=clean(q?.question_code),grading=clean(q?.grading_mode)||'graded';
      if(!code)push(errors,'QUESTION_CODE_REQUIRED',qp+'.question_code','question_code is required.');
      else if(questionCodes.has(code))push(errors,'DUPLICATE_QUESTION_CODE',qp+'.question_code','question_code must be unique.');
      else questionCodes.add(code);
      if(!['single_choice','numeric','short_answer'].includes(q?.type))push(errors,'UNSUPPORTED_QUESTION_TYPE',qp+'.type','Unsupported support-workbook question type.');
      if(!['book_exact','book_adapted'].includes(q?.origin))push(errors,'INVALID_ORIGIN',qp+'.origin','Origin must be book_exact or book_adapted.');
      if(q?.origin==='book_adapted'&&!clean(q?.source_note))push(errors,'BOOK_ADAPTATION_NOTE_REQUIRED',qp+'.source_note','Visual semantic adaptations need an explicit note.');
      else if(clean(q?.source_note))visibleTextChecks(errors,qp+'.source_note',q.source_note,{selfContained:false,duplicate:false});
      const prompt=clean(q?.prompt);
      if(!prompt)push(errors,'PROMPT_REQUIRED',qp+'.prompt','Prompt is required.');
      else visibleTextChecks(errors,qp+'.prompt',prompt);
      if(!Number.isInteger(q?.pdf_page)||q.pdf_page<1||q.pdf_page>source.pdf_pages)push(errors,'SOURCE_PAGE_INVALID',qp+'.pdf_page','Invalid original PDF page.');
      else if(!pages.includes(q.pdf_page))push(errors,'SOURCE_PAGE_OUTSIDE_SESSION',qp+'.pdf_page','Question page must belong to its session.');
      const profile=clean(q?.hint_profile);
      const hs=profiles[profile];
      if(!Array.isArray(hs)||hs.length!==4)push(errors,'HINT_PROFILE_UNKNOWN',qp+'.hint_profile','Question needs a valid four-level hint profile.');
      if(!['ar','tr','en'].includes(clean(q?.prompt_language)))push(errors,'PROMPT_LANGUAGE_REQUIRED',qp+'.prompt_language','Support Learning questions must declare prompt_language as ar, tr, or en.');
      if(typeof q?.decomposable!=='boolean')push(errors,'DECOMPOSABLE_CLASSIFICATION_REQUIRED',qp+'.decomposable','Support Learning questions must explicitly classify decomposable true or false.');
      if(q?.decomposable===true){
        const levels=decomposition[profile];
        if(!Array.isArray(levels)||levels.length!==4){
          push(errors,'DECOMPOSITION_PROFILE_REQUIRED',qp+'.hint_profile','Decomposable support questions need four decomposition levels for the selected hint profile.');
        }else{
          levels.forEach((level,li)=>{
            const dp='hint_decomposition.'+profile+'['+li+']';
            const steps=Array.isArray(level?.steps)?level.steps:[];
            const expanded=Array.isArray(level?.expanded_steps)?level.expanded_steps:[];
            if(steps.length!==3||steps.some(step=>!clean(step)))push(errors,'HINT_THREE_STEP_SHAPE',dp+'.steps','Decomposable support hints require exactly 3 non-empty steps.');
            if(expanded.length!==6||expanded.some(step=>!clean(step)))push(errors,'HINT_SIX_STEP_SHAPE',dp+'.expanded_steps','Decomposable support hints require exactly 6 non-empty expanded steps.');
            [...steps,...expanded].forEach((step,di)=>visibleTextChecks(errors,dp+'.step['+di+']',step));
            for(const candidate of answerCandidates(q)){
              const combined=[...(hs||[]),...steps,...expanded].join(' ');
              if(hintLeaks(combined,candidate))push(errors,'HINT_ANSWER_LEAK',dp,'Decomposition support exposes an accepted final answer.');
            }
          });
        }
      }
      if(!['graded','ungraded'].includes(grading))push(errors,'GRADING_MODE_INVALID',qp+'.grading_mode','grading_mode must be graded or ungraded.');
      if(grading==='ungraded'){
        if(Number(q?.points)!==0)push(errors,'UNGRADED_POINTS_NONZERO',qp+'.points','Ungraded reflection must be zero-point.');
        if(q?.answer!=null)push(errors,'UNGRADED_ANSWER_KEY_FORBIDDEN',qp+'.answer','Ungraded reflection cannot carry a fake canonical answer.');
      }else{
        if(Number(q?.points)<=0)push(errors,'GRADED_POINTS_REQUIRED',qp+'.points','Graded question needs positive points.');
        if(!q?.answer||typeof q.answer!=='object')push(errors,'ANSWER_KEY_REQUIRED',qp+'.answer','Graded question requires an answer.');
        if(!clean(q?.explanation_ar))push(errors,'GRADED_EXPLANATION_REQUIRED',qp+'.explanation_ar','Graded question requires Arabic learner feedback.');
        else visibleTextChecks(errors,qp+'.explanation_ar',q.explanation_ar,{arabic:true});
      }
      if(q?.type==='single_choice'){
        const opts=Array.isArray(q.options)?q.options:[];
        if(opts.length<2||opts.length>6||opts.some(x=>!clean(x)))push(errors,'OPTION_COUNT_OR_CONTENT_INVALID',qp+'.options','Official single-choice item requires 2–6 options.');
        opts.forEach((option,oi)=>visibleTextChecks(errors,qp+'.options['+oi+']',option));
        const pos=Number(q?.answer?.option_position);
        if(grading==='graded'&&(!Number.isInteger(pos)||pos<1||pos>opts.length))push(errors,'SINGLE_CHOICE_ANSWER_INVALID',qp+'.answer.option_position','Answer position must reference an option.');
      }
      if(q?.type==='numeric'&&grading==='graded'){
        const numericAnswer=clean(q?.answer?.value);
        if(!numericAnswer||!Number.isFinite(Number(numericAnswer.replace(',','.'))))push(errors,'NUMERIC_ANSWER_INVALID',qp+'.answer.value','Numeric answer must be a non-empty finite value.');
      }
      if(q?.type==='short_answer'&&grading==='graded'){
        const accepted=Array.isArray(q?.answer?.accepted_text)?q.answer.accepted_text.map(clean).filter(Boolean):[];
        if(!accepted.length&&!clean(q?.answer?.value))push(errors,'SHORT_ANSWER_KEY_INVALID',qp+'.answer','Short answer needs accepted_text or value.');
      }
      if(Array.isArray(hs)&&grading==='graded'){
        for(const candidate of answerCandidates(q))for(const [hi,h] of hs.entries())if(hintLeaks(h,candidate))push(errors,'HINT_ANSWER_LEAK',qp+'.hint_profile['+hi+']','Hint exposes an accepted final answer.');
      }
    });
  });
  return{ok:errors.length===0,errors,warnings};
}
