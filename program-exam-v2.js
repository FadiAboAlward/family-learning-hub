(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const EXAM_API=`${SUPABASE_URL}/functions/v1/exam-v2-api`;
  const safe=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderMath=(s='')=>typeof math==='function'?math(safe(s)):safe(s);
  const learnerToken=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';

  async function examApi(action,payload={}){
    const token=learnerToken(); if(!token) throw new Error('AUTH_REQUIRED');
    const r=await fetch(EXAM_API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload})});
    const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error||'SERVER_ERROR'); return d;
  }

  function disableLegacy(){
    const oldLearn=document.getElementById('fractionQuiz'); if(oldLearn) oldLearn.style.display='none';
    document.getElementById('fractionExam')?.remove();
    document.querySelectorAll('[data-program-error]').forEach(el=>{
      if((el.textContent||'').includes('التدريب القديم')) el.textContent='تعذر تحميل البرامج من قاعدة البيانات. لم نعرض أي محتوى احتياطي حتى لا يظهر تدريب لطالب غير مخصص له.';
    });
  }

  function installExamButtons(){
    disableLegacy();
    document.querySelectorAll('.dynamic-program-quiz[data-quiz-slug]').forEach(card=>{
      const slug=card.getAttribute('data-quiz-slug')||'';
      if(!slug||document.querySelector(`.exam-v2-card[data-exam-slug="${CSS.escape(slug)}"]`)) return;
      const btn=document.createElement('button');
      btn.className='quiz-card mode-card exam-mode-card exam-v2-card';
      btn.dataset.examSlug=slug;
      btn.innerHTML='<div class="mode-icon">📝</div><b>وضع الامتحان</b><div class="muted">بدون تلميحات أو تصحيح أثناء الحل. النتيجة والمراجعة بعد التسليم.</div><span class="mode-tag">امتحان</span>';
      btn.addEventListener('click',()=>startExam(slug));
      card.insertAdjacentElement('afterend',btn);
    });
  }

  async function startExam(slug){
    if(typeof shell!=='function') return;
    shell('📝 جاري تجهيز الامتحان','الأسئلة تُحمّل من البرنامج المرتبط بهذا الحساب.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let session;
    try{ session=await examApi('start_exam',{quiz_slug:slug}); }
    catch{ shell('تعذر فتح الامتحان','هذا الامتحان غير متاح لهذا الطالب.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="examV2Back">رجوع</button></div></section>'); document.getElementById('examV2Back')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile)); return; }

    const questions=session.questions||[];
    const answers=new Map(questions.filter(x=>x.saved_response?.option_position!=null).map(x=>[x.question_id,Number(x.saved_response.option_position)]));
    let index=0;

    function allAnswered(){ return questions.length>0 && questions.every(x=>answers.has(x.question_id)); }
    function render(){
      if(!questions.length){ shell('لا توجد أسئلة','هذا الامتحان لا يحتوي أسئلة منشورة.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="examV2Back">رجوع</button></div></section>'); document.getElementById('examV2Back')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile)); return; }
      const row=questions[index], q=row.question, selected=answers.get(row.question_id);
      const opts=(q.options||[]).map(o=>`<button class="answer exam-v2-answer ${Number(o.position)===selected?'selected':''}" data-pos="${Number(o.position)}"><span class="answer-number">${Number(o.position)}</span><span>${renderMath(o.content)}</span></button>`).join('');
      const nav=questions.map((x,i)=>`<button class="btn btn-soft exam-v2-nav" data-i="${i}">${answers.has(x.question_id)?'✓ ':''}${i+1}</button>`).join('');
      shell(`📝 ${safe(session.quiz.title)}`,`السؤال ${index+1} من ${questions.length} — لا يظهر التصحيح إلا بعد التسليم.`,`<section class="panel">
        <div class="exam-status"><div class="topline"><b>السؤال ${index+1} من ${questions.length}</b><span>${answers.size}/${questions.length} مجاب</span></div></div>
        <div class="question"><b>${renderMath(q.prompt)}</b></div>
        <div id="examV2Answers" class="answers answer-layout-v8">${opts}</div>
        <div class="actions"><button class="btn btn-soft" id="examV2Prev" ${index===0?'disabled':''}>السابق</button><button class="btn btn-soft" id="examV2Next" ${index===questions.length-1?'disabled':''}>التالي</button></div>
        <div class="section-title">الأسئلة</div><div id="examV2Navigator" class="actions">${nav}</div>
        <div class="actions"><button class="btn btn-primary" id="examV2Submit" ${allAnswered()?'':'disabled'}>تسليم الامتحان</button><button class="btn btn-soft" id="examV2Exit">رجوع لصفحتي</button></div>
      </section>`);
      document.querySelectorAll('.exam-v2-answer').forEach(btn=>btn.addEventListener('click',async()=>{
        const pos=Number(btn.getAttribute('data-pos')); document.querySelectorAll('.exam-v2-answer').forEach(x=>x.disabled=true);
        try{ await examApi('save_answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos}); answers.set(row.question_id,pos); render(); }
        catch{ document.querySelectorAll('.exam-v2-answer').forEach(x=>x.disabled=false); }
      }));
      document.querySelectorAll('.exam-v2-nav').forEach(btn=>btn.addEventListener('click',()=>{index=Number(btn.getAttribute('data-i'));render();}));
      document.getElementById('examV2Prev')?.addEventListener('click',()=>{index=Math.max(0,index-1);render();});
      document.getElementById('examV2Next')?.addEventListener('click',()=>{index=Math.min(questions.length-1,index+1);render();});
      document.getElementById('examV2Exit')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile));
      document.getElementById('examV2Submit')?.addEventListener('click',submit);
    }

    async function submit(){
      if(!allAnswered()) return;
      shell('📊 عم نصحح الامتحان','التصحيح يتم على السيرفر.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
      try{
        const d=await examApi('submit_exam',{attempt_id:session.attempt_id});
        const review=(d.review||[]).map((r,i)=>`<details class="exam-review"><summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}</summary><div>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted">${renderMath(r.explanation)}</div>`:''}</details>`).join('');
        shell('📊 نتيجة الامتحان',`${Number(d.percentage||0)}%`,`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">النقاط<b>${Number(d.score_points||0)}/${Number(d.max_points||0)}</b></div></div><div class="section-title">المراجعة</div>${review}<div class="actions"><button class="btn btn-primary" id="examV2Home">رجوع لصفحتي</button></div></section>`);
        document.getElementById('examV2Home')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile));
      }catch{ shell('تعذر تسليم الامتحان','إجاباتك المحفوظة موجودة. جرّب التسليم مرة ثانية.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="examV2Retry">إعادة التسليم</button></div></section>'); document.getElementById('examV2Retry')?.addEventListener('click',submit); }
    }
    render();
  }

  const observer=new MutationObserver(()=>{disableLegacy();installExamButtons();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{disableLegacy();installExamButtons();});
  disableLegacy(); installExamButtons();
})();
