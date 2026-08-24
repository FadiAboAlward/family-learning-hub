(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const EXAM_API=`${SUPABASE_URL}/functions/v1/exam-v2-api`;
  const safe=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderMath=(s='')=>typeof math==='function'?math(safe(s)):safe(s);
  const learnerToken=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  async function examApi(action,payload={}){const t=learnerToken();if(!t)throw new Error('AUTH_REQUIRED');const r=await fetch(EXAM_API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok)throw new Error(d.error||'SERVER_ERROR');return d;}
  const home=()=>{if(typeof renderStudentHome==='function'&&typeof state!=='undefined')renderStudentHome(state.learnerProfile)};
  function preloadQuestion(q){if(!q)return;(q.assets||[]).forEach(a=>{if(a?.url){const img=new Image();img.decoding='async';img.src=a.url;}});}
  function assetsHtml(q){return(q.assets||[]).filter(a=>a?.url).map(a=>`<figure class="flh-q-asset"><img src="${safe(a.url)}" alt="${safe(a.alt_text||'صورة السؤال')}" loading="eager" decoding="async"></figure>`).join('');}

  async function startExam(slug){
    if(typeof shell!=='function')return;
    shell('📝 جاري تجهيز الامتحان','إجاباتك تُحفظ تلقائيًا.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let session;try{session=await examApi('start_exam',{quiz_slug:slug});}catch{shell('تعذر فتح الامتحان','هذا الامتحان غير متاح لهذا الطالب.','<section class="panel"><button class="btn btn-primary" id="examBack">رجوع</button></section>');document.getElementById('examBack')?.addEventListener('click',home);return;}

    const questions=session.questions||[];
    const answers=new Map(questions.filter(x=>x.saved_response?.option_position!=null).map(x=>[x.question_id,Number(x.saved_response.option_position)]));
    const flagged=new Set(questions.filter(x=>x.is_flagged).map(x=>x.question_id));
    const storageKey=`flh_exam_index_${session.attempt_id}`;
    let stored=Number(localStorage.getItem(storageKey));
    let index=Number.isInteger(stored)&&stored>=0&&stored<questions.length?stored:Math.max(0,questions.findIndex(x=>!answers.has(x.question_id)));
    if(index<0)index=0;
    let saving=false,submitting=false,touchStart=null;
    const allAnswered=()=>questions.length>0&&questions.every(x=>answers.has(x.question_id));
    const answeredCount=()=>answers.size;
    const unansweredCount=()=>questions.length-answers.size;
    const flaggedCount=()=>flagged.size;

    function navTo(i){if(saving||submitting||i<0||i>=questions.length)return;index=i;localStorage.setItem(storageKey,String(index));render();}
    function statusClass(qid,i){return['flh-exam-nav',i===index?'current':'',answers.has(qid)?'answered':'unanswered',flagged.has(qid)?'flagged':''].filter(Boolean).join(' ')}

    function render(){
      if(!questions.length){shell('لا توجد أسئلة','هذا الامتحان لا يحتوي أسئلة منشورة.','<section class="panel"><button class="btn btn-primary" id="examBack">رجوع</button></section>');document.getElementById('examBack')?.addEventListener('click',home);return;}
      const row=questions[index],q=row.question,selected=answers.get(row.question_id),isFlagged=flagged.has(row.question_id);
      const opts=(q.options||[]).map(o=>{const pos=Number(o.position),sel=pos===selected;return`<button class="answer exam-v3-answer ${sel?'selected':''}" data-pos="${pos}" ${saving?'disabled':''}><span class="answer-number">${sel?'✓':pos}</span><span>${renderMath(o.content)}</span></button>`}).join('');
      const nav=questions.map((x,i)=>`<button class="${statusClass(x.question_id,i)}" data-i="${i}" ${saving?'disabled':''}>${flagged.has(x.question_id)?'🚩 ':answers.has(x.question_id)?'✓ ':''}${i+1}</button>`).join('');
      const resume=session.resumed?'<div class="flh-resume-note">↩️ رجعناك لامتحانك، وإجاباتك المحفوظة موجودة.</div>':'';
      shell(`📝 ${safe(session.quiz.title)}`,`السؤال ${index+1} من ${questions.length} — لا يظهر التصحيح قبل التسليم.`,`<section class="panel flh-touch-quiz flh-exam-swipe-zone">${resume}<div class="exam-status"><div class="topline"><b>السؤال ${index+1} من ${questions.length}</b><span>${answeredCount()}/${questions.length} مجاب</span></div><div class="flh-exam-summary"><span class="answered-dot">✓ ${answeredCount()} مجاب</span><span class="unanswered-dot">○ ${unansweredCount()} غير مجاب</span><span class="flagged-dot">🚩 ${flaggedCount()} للمراجعة</span></div></div>${q.question_code?`<div class="flh-code-inline">🔖 ${safe(q.question_code)}</div>`:''}${assetsHtml(q)}<div class="question"><b>${renderMath(q.prompt)}</b></div><div class="flh-instruction">ضغطة واحدة تختار وتحفظ. تقدر تغيّر جوابك بأي وقت قبل التسليم.</div><div id="examV3Answers" class="answers answer-layout-v8">${opts}</div><div class="muted">${saving?'جارِ حفظ الإجابة…':selected?'✓ الإجابة محفوظة تلقائيًا.':'اختر إجابتك.'}</div><div class="flh-exam-tools"><button class="btn btn-soft ${isFlagged?'flh-flag-on':''}" id="examFlag" ${saving?'disabled':''}>${isFlagged?'🚩 إزالة علامة المراجعة':'🚩 راجع لاحقًا'}</button></div><div class="flh-exam-nav-grid">${nav}</div><div class="flh-swipe-hint">اسحب ← للتالي، → للسابق</div><div class="flh-sticky-action flh-exam-bottom"><button class="btn btn-soft" id="examPrev" ${(index===0||saving)?'disabled':''}>السابق</button><button class="btn btn-soft" id="examNext" ${(index===questions.length-1||saving)?'disabled':''}>التالي</button><button class="btn btn-primary" id="examSubmit" ${(!allAnswered()||saving||submitting)?'disabled':''}>تسليم الامتحان</button></div><button class="btn btn-soft flh-exit-link" id="examExit" ${saving?'disabled':''}>رجوع لصفحتي — كل شيء محفوظ</button></section>`);
      document.querySelectorAll('.exam-v3-answer').forEach(b=>b.addEventListener('click',()=>saveAnswer(b)));
      document.querySelectorAll('.flh-exam-nav').forEach(b=>b.addEventListener('click',()=>navTo(Number(b.getAttribute('data-i')))));
      document.getElementById('examPrev')?.addEventListener('click',()=>navTo(index-1));
      document.getElementById('examNext')?.addEventListener('click',()=>navTo(index+1));
      document.getElementById('examExit')?.addEventListener('click',home);
      document.getElementById('examFlag')?.addEventListener('click',toggleFlag);
      document.getElementById('examSubmit')?.addEventListener('click',submitGate);
      const zone=document.querySelector('.flh-exam-swipe-zone');
      zone?.addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY,target:e.target};},{passive:true});
      zone?.addEventListener('touchend',e=>{if(!touchStart||saving)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y,target=touchStart.target;touchStart=null;if(target?.closest?.('button,.answer,input,textarea,select,a'))return;if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.25)return;if(dx<0)navTo(index+1);else navTo(index-1);},{passive:true});
      preloadQuestion(questions[index+1]?.question);if(session.resumed)session.resumed=false;
    }

    async function saveAnswer(btn){
      if(saving)return;const row=questions[index],pos=Number(btn.getAttribute('data-pos'));saving=true;render();
      try{await examApi('save_answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});answers.set(row.question_id,pos);}
      catch{}
      finally{saving=false;render();}
    }

    async function toggleFlag(){
      if(saving)return;const row=questions[index],next=!flagged.has(row.question_id);saving=true;render();
      try{await examApi('set_flag',{attempt_id:session.attempt_id,question_id:row.question_id,is_flagged:next});if(next)flagged.add(row.question_id);else flagged.delete(row.question_id);}
      catch{}
      finally{saving=false;render();}
    }

    function submitGate(){
      if(!allAnswered()||saving||submitting)return;
      if(flaggedCount()>0){shell('🚩 عندك أسئلة للمراجعة',`علّمت ${flaggedCount()} سؤال/أسئلة للمراجعة.`,`<section class="panel"><div class="flh-submit-choice"><button class="btn btn-soft" id="reviewFlags">راجعها أولًا</button><button class="btn btn-primary" id="submitAnyway">سلّم الامتحان</button></div></section>`);document.getElementById('reviewFlags')?.addEventListener('click',()=>{const i=questions.findIndex(x=>flagged.has(x.question_id));index=i>=0?i:index;render();});document.getElementById('submitAnyway')?.addEventListener('click',submit);return;}
      submit();
    }

    async function submit(){
      if(submitting||saving||!allAnswered())return;submitting=true;shell('📊 عم نصحح الامتحان','التصحيح يتم على السيرفر.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
      try{const d=await examApi('submit_exam',{attempt_id:session.attempt_id});localStorage.removeItem(storageKey);const review=(d.review||[]).map((r,i)=>`<details class="exam-review"><summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}${r.was_flagged?' 🚩':''}${r.question_code?` · ${safe(r.question_code)}`:''}</summary><div>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted">${renderMath(r.explanation)}</div>`:''}</details>`).join('');shell('📊 نتيجة الامتحان',`${Number(d.percentage||0)}%`,`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">النقاط<b>${Number(d.score_points||0)}/${Number(d.max_points||0)}</b></div></div><div class="section-title">المراجعة</div>${review}<div class="flh-sticky-action"><button class="btn btn-primary" id="examHome">رجوع لصفحتي</button></div></section>`);document.getElementById('examHome')?.addEventListener('click',home);}
      catch{submitting=false;shell('تعذر تسليم الامتحان','إجاباتك المحفوظة موجودة.','<section class="panel"><button class="btn btn-primary" id="examRetry">إعادة التسليم</button></section>');document.getElementById('examRetry')?.addEventListener('click',submit);}
    }
    render();
  }
  window.FLH=window.FLH||{};window.FLH.startExamQuiz=startExam;
})();
