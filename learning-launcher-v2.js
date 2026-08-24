(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/learning-api`;
  const safe=(s='')=>typeof esc==='function'?esc(s):String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const renderMath=(s='')=>typeof math==='function'?math(safe(s)):safe(s);
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  async function call(action,payload={}){const t=token();if(!t)throw new Error('AUTH_REQUIRED');const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok)throw new Error(d.error||'SERVER_ERROR');return d;}
  async function refreshProfile(){try{if(typeof api==='function'&&typeof state!=='undefined')state.learnerProfile=await api('student_profile',{},token());}catch{}}
  function preloadQuestion(q){if(!q)return;(q.assets||[]).forEach(a=>{if(a?.url){const img=new Image();img.decoding='async';img.src=a.url;}});}
  function assetsHtml(q){return(q.assets||[]).filter(a=>a?.url).map(a=>`<figure class="flh-q-asset"><img src="${safe(a.url)}" alt="${safe(a.alt_text||'صورة السؤال')}" loading="eager" decoding="async"></figure>`).join('');}
  function home(){if(typeof renderStudentHome==='function'&&typeof state!=='undefined')renderStudentHome(state.learnerProfile);}

  async function startLearningQuiz(slug){
    if(!slug||typeof shell!=='function')return;
    shell('🧠 جاري تجهيز وضع التعلّم','رح نساعدك خطوة بخطوة.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let session;
    try{session=await call('start_quiz',{quiz_slug:slug});}
    catch{shell('تعذر بدء التدريب','هذا التدريب غير متاح لهذا الحساب.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="learnBack">رجوع</button></div></section>');document.getElementById('learnBack')?.addEventListener('click',home);return;}

    const queue=(session.queue||[]).map(x=>({...x}));
    const started=Date.now();
    let index=queue.findIndex(x=>x.status==='active');if(index<0)index=Math.max(0,queue.findIndex(x=>!['completed','skipped'].includes(x.status)));
    let busy=false,confirmAfterSave=false,currentHint=null;
    const remaining=()=>queue.some(x=>!['completed','skipped'].includes(x.status));
    const nextIndex=()=>queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));
    const qshell=html=>shell(`🧠 ${safe(session.quiz.title)}`,'وضع التعلّم — اختَر، فكّر، واستعمل المساعدة وقت الحاجة.',html);

    async function finish(){
      qshell('<section class="panel"><div class="loading-card">عم نحسب النتيجة من إجاباتك المحفوظة…</div></section>');
      try{
        const d=await call('finish_quiz',{attempt_id:session.attempt_id,duration_seconds:Math.max(1,Math.round((Date.now()-started)/1000))});
        await refreshProfile();
        const review=(d.review||[]).map((r,i)=>`<details class="exam-review"><summary>${r.is_correct?'✅':'❌'} السؤال ${i+1}${r.question_code?` · ${safe(r.question_code)}`:''}</summary><div>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted">${renderMath(r.explanation)}</div>`:''}</details>`).join('');
        const award=d.award?.already_awarded?'<div class="muted">مكافأة هذا التدريب محسوبة سابقًا.</div>':`<div class="award-pop">🎉 +${Number(d.award?.xp||0)} XP &nbsp; 🪙 +${Number(d.award?.reward_points||0)} نقطة</div>`;
        qshell(`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">من أول مرة<b>${Number(d.first_try_correct||0)}</b></div><div class="stat">التلميحات<b>${Number(d.hints_used||0)}</b></div></div>${award}<div class="section-title">مراجعة</div>${review||'<div class="empty">لا توجد مراجعة.</div>'}<div class="flh-sticky-action"><button class="btn btn-primary" id="learnHome">رجوع لمكتبتي</button></div></section>`);
        document.getElementById('learnHome')?.addEventListener('click',home);
      }catch{qshell('<section class="panel"><div class="error">تعذر إنهاء التدريب، لكن إجاباتك المحفوظة لم تضِع.</div><div class="flh-sticky-action"><button class="btn btn-primary" id="learnRetryFinish">إعادة المحاولة</button></div></section>');document.getElementById('learnRetryFinish')?.addEventListener('click',finish);}
    }

    function render(){
      if(!remaining()||index<0||index>=queue.length)return finish();
      const row=queue[index],q=row?.question;if(!q)return finish();
      const selected=Number(row.draft_option_position||0)||null;
      const opts=(q.options||[]).map(o=>{const pos=Number(o.position),sel=pos===selected;return`<button class="answer flh-learn-answer ${sel?'selected confirm-ready':''}" data-pos="${pos}" ${busy?'disabled':''}><span class="answer-number">${sel?'✓':pos}</span><span>${renderMath(o.content)}</span>${sel?'<small class="flh-answer-confirm">اضغط مرة ثانية للتأكيد</small>':''}</button>`}).join('');
      const src=q.source_page_start?`PDF ${q.source_page_start}${q.source_page_end&&q.source_page_end!==q.source_page_start?`–${q.source_page_end}`:''}`:'';
      const restored=session.resumed?'<div class="flh-resume-note">↩️ رجعناك لنفس التدريب، وكل ما حفظته موجود.</div>':'';
      const hintBox=currentHint?.content?`<div class="flh-hint-card"><b>💡 تلميح ${Number(currentHint.hint_level||row.hint_level_requested||1)}</b><div>${renderMath(currentHint.content)}</div></div>`:(Number(row.hint_level_requested||0)>0?`<div class="muted">استخدمت ${Number(row.hint_level_requested)} تلميح/تلميحات سابقًا في هذا السؤال.</div>`:'');
      qshell(`<section class="panel flh-touch-quiz">${restored}<div class="topline"><b>السؤال ${index+1}</b><span class="mode-tag">${row.source_role==='remediation'?'تدريب مساعد':'أساسي'}</span></div>${q.question_code?`<div class="flh-code-inline">🔖 ${safe(q.question_code)}</div>`:''}${src?`<div class="muted">${safe(src)}</div>`:''}${assetsHtml(q)}<div class="question"><b>${renderMath(q.prompt)}</b></div><div class="flh-instruction">ضغطة للاختيار، وضغطة ثانية على نفس الجواب للتأكيد.</div><div class="answer-grid">${opts}</div><div id="flhLearnStatus" class="muted">${busy?'جارِ الحفظ…':selected?'اختيارك محفوظ. اضغطه مرة ثانية عندما تتأكد.':'اختر جوابك.'}</div><div id="flhLearnHint">${hintBox}</div><div id="flhLearnFeedback"></div><div class="flh-learning-tools"><button class="btn btn-soft flh-help-btn" id="flhHelp" ${busy||Number(row.hint_level_requested||0)>=4?'disabled':''}>💡 ساعدني</button><button class="btn btn-soft" id="flhLearnExit" ${busy?'disabled':''}>رجوع لمكتبتي</button></div></section>`);
      document.getElementById('flhLearnExit')?.addEventListener('click',home);
      document.getElementById('flhHelp')?.addEventListener('click',help);
      document.querySelectorAll('.flh-learn-answer').forEach(b=>b.addEventListener('click',()=>choose(b)));
      const ni=queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));if(ni>=0)preloadQuestion(queue[ni]?.question);
      if(session.resumed)session.resumed=false;
    }

    async function choose(btn){
      if(busy)return;const row=queue[index],pos=Number(btn.getAttribute('data-pos'));
      if(Number(row.draft_option_position||0)===pos){return confirmAnswer(pos);}
      row.draft_option_position=pos;currentHint=currentHint;busy=true;confirmAfterSave=false;render();
      try{await call('save_draft',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});}
      catch{row.draft_option_position=null;}
      finally{busy=false;if(confirmAfterSave&&Number(row.draft_option_position||0)===pos){confirmAfterSave=false;return confirmAnswer(pos);}render();}
    }

    async function confirmAnswer(pos){
      if(busy){confirmAfterSave=true;return;}busy=true;render();
      const row=queue[index];
      try{
        const d=await call('answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});
        row.draft_option_position=null;if(d.hint_level)row.hint_level_requested=Math.max(Number(row.hint_level_requested||0),Number(d.hint_level));
        if(!d.finalized){currentHint=d.hint||null;busy=false;render();const f=document.getElementById('flhLearnFeedback');if(f)f.innerHTML='<div class="error">مو هي الإجابة بعد. جرّب من جديد.</div>';return;}
        row.status='completed';currentHint=null;if(d.remediation_added?.question)queue.push(d.remediation_added);
        busy=false;
        const ni=nextIndex();
        const feedback=`${d.is_correct?'<div class="award-pop">✅ ممتاز!</div>':'<div class="error">خلصت المحاولات لهذا السؤال.</div>'}${d.explanation?`<div class="flh-explanation"><b>الشرح</b><div>${renderMath(d.explanation)}</div></div>`:''}<div class="flh-sticky-action"><button class="btn btn-primary flh-next-big" id="flhLearnNext">${ni>=0?'السؤال التالي':'إنهاء التدريب'}</button></div>`;
        qshell(`<section class="panel flh-touch-quiz"><div class="topline"><b>السؤال ${index+1}</b><span class="mode-tag">تم</span></div>${row.question?.question_code?`<div class="flh-code-inline">🔖 ${safe(row.question.question_code)}</div>`:''}<div class="question"><b>${renderMath(row.question?.prompt||'')}</b></div>${feedback}</section>`);
        document.getElementById('flhLearnNext')?.addEventListener('click',()=>{if(ni>=0){index=ni;render();}else finish();});
        if(ni>=0)preloadQuestion(queue[ni]?.question);
      }catch{busy=false;render();const f=document.getElementById('flhLearnFeedback');if(f)f.innerHTML='<div class="error">صار خطأ بالحفظ. جرّب مرة ثانية.</div>';}
    }

    async function help(){
      if(busy)return;busy=true;render();const row=queue[index];
      try{const d=await call('request_hint',{attempt_id:session.attempt_id,question_id:row.question_id});if(d.hint){row.hint_level_requested=Number(d.hint_level||row.hint_level_requested||0);currentHint=d.hint;}else if(d.exhausted){row.hint_level_requested=Math.max(4,Number(row.hint_level_requested||0));currentHint={hint_level:4,content:'وصلت لآخر مستوى من التلميحات. جرّب تفكر بالخطوات اللي أخذناها.'};}}
      catch{currentHint={hint_level:row.hint_level_requested||0,content:'تعذر تحميل التلميح الآن. جرّب مرة ثانية.'};}
      finally{busy=false;render();}
    }

    render();
  }
  window.FLH=window.FLH||{};window.FLH.startLearningQuiz=startLearningQuiz;
})();
