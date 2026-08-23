(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/learning-api`;
  const safe=(s='')=>typeof esc==='function'?esc(s):String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderMath=(s='')=>typeof math==='function'?math(safe(s)):safe(s);
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  async function call(action,payload={}){const t=token();if(!t)throw new Error('AUTH_REQUIRED');const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok)throw new Error(d.error||'SERVER_ERROR');return d;}
  async function refreshProfile(){try{if(typeof api==='function'&&typeof state!=='undefined')state.learnerProfile=await api('student_profile',{},token());}catch{}}

  async function startLearningQuiz(slug){
    if(!slug||typeof shell!=='function')return;
    shell('🧠 جاري تجهيز وضع التعلّم','رح نساعدك خطوة بخطوة.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let session;
    try{session=await call('start_quiz',{quiz_slug:slug});}
    catch{shell('تعذر بدء التدريب','هذا التدريب غير متاح لهذا الحساب.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="learnBack">رجوع</button></div></section>');document.getElementById('learnBack')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile));return;}
    const queue=(session.queue||[]).map(x=>({...x}));const started=Date.now();let index=Math.max(0,queue.findIndex(x=>!['completed','skipped'].includes(x.status)));if(index<0)index=queue.length;
    const remaining=()=>queue.some(x=>!['completed','skipped'].includes(x.status));
    const nextIndex=()=>queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));
    const qshell=html=>shell(`🧠 ${safe(session.quiz.title)}`,'وضع التعلّم — جرّب، وخذ تلميحًا عند الحاجة.',html);

    async function finish(){
      qshell('<section class="panel"><div class="loading-card">عم نحسب النتيجة من إجاباتك المحفوظة…</div></section>');
      try{const d=await call('finish_quiz',{attempt_id:session.attempt_id,duration_seconds:Math.max(1,Math.round((Date.now()-started)/1000))});await refreshProfile();const review=(d.review||[]).map((r,i)=>`<details class="exam-review"><summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}</summary><div>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted">${renderMath(r.explanation)}</div>`:''}</details>`).join('');const award=d.award?.already_awarded?'<div class="muted">XP لهذا التدريب كان محسوبًا سابقًا.</div>':`<div class="award-pop">🎉 +${Number(d.award?.xp||0)} XP &nbsp; 🪙 +${Number(d.award?.reward_points||0)} نقطة</div>`;qshell(`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">من أول مرة<b>${Number(d.first_try_correct||0)}</b></div><div class="stat">التلميحات<b>${Number(d.hints_used||0)}</b></div></div>${award}<div class="section-title">مراجعة</div>${review||'<div class="empty">لا توجد مراجعة.</div>'}<div class="actions"><button class="btn btn-primary" id="learnHome">رجوع لمكتبتي</button></div></section>`);document.getElementById('learnHome')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile));}
      catch{qshell('<section class="panel"><div class="error">تعذر إنهاء التدريب، لكن إجاباتك المحفوظة لم تضِع.</div><div class="actions"><button class="btn btn-primary" id="learnRetryFinish">إعادة المحاولة</button></div></section>');document.getElementById('learnRetryFinish')?.addEventListener('click',finish);}
    }

    function render(){
      if(!remaining()||index>=queue.length)return finish();const row=queue[index],q=row?.question;if(!q)return finish();const opts=(q.options||[]).map(o=>`<button class="answer flh-learn-answer" data-pos="${Number(o.position)}"><span class="answer-number">${Number(o.position)}</span><span>${renderMath(o.content)}</span></button>`).join('');const src=q.source_page_start?`PDF ${q.source_page_start}${q.source_page_end&&q.source_page_end!==q.source_page_start?`–${q.source_page_end}`:''}`:'';qshell(`<section class="panel"><div class="topline"><b>السؤال ${index+1}</b><span class="mode-tag">${row.source_role==='remediation'?'تدريب مساعد':'أساسي'}</span></div>${src?`<div class="muted">${safe(src)}</div>`:''}<div class="question"><b>${renderMath(q.prompt)}</b></div><div class="answer-grid">${opts}</div><div id="flhLearnFeedback"></div><div class="actions"><button class="btn btn-soft" id="flhLearnExit">رجوع لمكتبتي</button></div></section>`);document.getElementById('flhLearnExit')?.addEventListener('click',()=>renderStudentHome(state.learnerProfile));document.querySelectorAll('.flh-learn-answer').forEach(b=>b.addEventListener('click',()=>answer(b)));
    }

    async function answer(btn){const row=queue[index],feedback=document.getElementById('flhLearnFeedback'),buttons=[...document.querySelectorAll('.flh-learn-answer')];buttons.forEach(b=>b.disabled=true);if(feedback)feedback.innerHTML='<div class="muted">عم نتحقق من إجابتك…</div>';try{const d=await call('answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:Number(btn.getAttribute('data-pos'))});if(!d.finalized){buttons.forEach(b=>b.disabled=false);if(feedback)feedback.innerHTML=`<div class="error">مو هي الإجابة بعد.</div>${d.hint?.content?`<div class="panel"><b>💡 تلميح ${Number(d.hint.hint_level||d.attempt_no)}</b><div>${renderMath(d.hint.content)}</div></div>`:''}`;return;}row.status='completed';if(d.remediation_added?.question)queue.push(d.remediation_added);if(feedback)feedback.innerHTML=`${d.is_correct?'<div class="award-pop">✅ ممتاز!</div>':'<div class="error">خلصت المحاولات لهذا السؤال.</div>'}${d.explanation?`<div class="panel"><b>الشرح</b><div>${renderMath(d.explanation)}</div></div>`:''}<div class="actions"><button class="btn btn-primary" id="flhLearnNext">${remaining()?'السؤال التالي':'إنهاء التدريب'}</button></div>`;document.getElementById('flhLearnNext')?.addEventListener('click',()=>{const n=nextIndex();if(n>=0){index=n;render();}else finish();});}catch{buttons.forEach(b=>b.disabled=false);if(feedback)feedback.innerHTML='<div class="error">صار خطأ بالحفظ. جرّب مرة ثانية.</div>';}}
    render();
  }
  window.FLH=window.FLH||{};window.FLH.startLearningQuiz=startLearningQuiz;
})();
