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
    shell('🧠 نحضّر نشاطك','لحظة صغيرة ونبدأ.','<section class="panel"><div class="loading-card">جارِ التحضير…</div></section>');
    let session;
    try{session=await call('start_quiz',{quiz_slug:slug});}
    catch{shell('ما قدرنا نفتح النشاط','جرّب مرة ثانية بعد شوي.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="learnBack">رجوع</button></div></section>');document.getElementById('learnBack')?.addEventListener('click',home);return;}

    const queue=(session.queue||[]).map(x=>({...x}));
    const started=Date.now();
    let index=queue.findIndex(x=>x.status==='active');if(index<0)index=Math.max(0,queue.findIndex(x=>!['completed','skipped'].includes(x.status)));
    let busy=false,currentHint=null,saveError=false;
    const remaining=()=>queue.some(x=>!['completed','skipped'].includes(x.status));
    const nextIndex=()=>queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));
    const qshell=html=>shell('🧠 وقت التعلّم',safe(session.quiz.title||'نشاط تعلّم'),html);

    async function finish(){
      shell('✨ خلصنا!','عم نجهّز نتيجتك.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
      try{
        const d=await call('finish_quiz',{attempt_id:session.attempt_id,duration_seconds:Math.max(1,Math.round((Date.now()-started)/1000))});
        await refreshProfile();
        const review=(d.review||[]).map((r,i)=>`<details class="exam-review flh-child-review"><summary>${r.is_correct?'✅':'🔁'} السؤال ${i+1}${r.question_code?`<span class="flh-review-code"> · ${safe(r.question_code)}</span>`:''}</summary><div>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted">${renderMath(r.explanation)}</div>`:''}</details>`).join('');
        const award=d.award?.already_awarded?'<div class="muted flh-result-note">مكافأة هذا النشاط محسوبة من قبل.</div>':`<div class="flh-child-award"><span>⭐ +${Number(d.award?.xp||0)}</span><span>🎁 +${Number(d.award?.reward_points||0)}</span></div>`;
        shell('🎉 أحسنت!','أنهيت النشاط بنجاح.',`<section class="panel flh-child-result"><div class="flh-result-score"><span>${Number(d.percentage||0)}%</span><b>${Number(d.percentage||0)>=80?'شغل رائع!':Number(d.percentage||0)>=60?'أحسنت، كمّل!':'كل محاولة بتعلّمك أكثر!'}</b></div>${award}${review?`<details class="flh-review-toggle"><summary>👀 شوف مراجعة الأسئلة</summary><div class="flh-review-list">${review}</div></details>`:''}<div class="flh-sticky-action"><button class="btn btn-primary flh-next-big" id="learnHome">ارجع لموادي</button></div></section>`);
        document.getElementById('learnHome')?.addEventListener('click',home);
      }catch{qshell('<section class="panel"><div class="error">ما قدرنا ننهي النشاط الآن، لكن إجاباتك محفوظة.</div><div class="flh-sticky-action"><button class="btn btn-primary" id="learnRetryFinish">جرّب مرة ثانية</button></div></section>');document.getElementById('learnRetryFinish')?.addEventListener('click',finish);}
    }

    function render(){
      if(!remaining()||index<0||index>=queue.length)return finish();
      const row=queue[index],q=row?.question;if(!q)return finish();
      const selected=Number(row.draft_option_position||0)||null;
      const opts=(q.options||[]).map(o=>{const pos=Number(o.position),sel=pos===selected;return`<button class="answer flh-learn-answer ${sel?'selected':''}" data-pos="${pos}" aria-pressed="${sel?'true':'false'}" ${busy?'disabled':''}><span class="answer-number" aria-hidden="true">${sel?'✓':pos}</span><span class="flh-answer-content">${renderMath(o.content)}</span></button>`}).join('');
      const restored=session.resumed?'<div class="flh-resume-note">↩️ رجعناك لنفس المكان. اختيارك السابق محفوظ.</div>':'';
      const hintBox=currentHint?.content?`<div class="flh-hint-card"><b>💡 فكرة تساعدك</b><div>${renderMath(currentHint.content)}</div></div>`:(Number(row.hint_level_requested||0)>0?`<div class="muted">استخدمت مساعدة في هذا السؤال.</div>`:'');
      const status=busy?'عم نحفظ اختيارك…':saveError?'ما انحفظ الاختيار. جرّب مرة ثانية.':selected?'تمام، جاهز للتأكيد.':'اختر جوابًا.';
      qshell(`<section class="panel flh-touch-quiz flh-child-learning">${restored}<div class="flh-child-question-head"><b>السؤال ${index+1}</b><span>${index+1} / ${queue.length}</span></div><div class="progress flh-question-progress"><span style="width:${Math.max(8,Math.round((index+1)/Math.max(1,queue.length)*100))}%"></span></div>${assetsHtml(q)}<div class="question"><b>${renderMath(q.prompt)}</b></div><div class="flh-instruction">اختر الإجابة التي تراها صحيحة.</div><div class="answer-grid">${opts}</div><div id="flhLearnStatus" class="flh-child-status ${saveError?'errorish':''}">${status}</div><div class="flh-sticky-action flh-confirm-area"><button class="btn btn-primary flh-next-big" id="flhConfirmAnswer" ${!selected||busy?'disabled':''}>تأكيد الإجابة</button></div><div id="flhLearnHint">${hintBox}</div><div id="flhLearnFeedback"></div><div class="flh-learning-tools flh-child-tools"><button class="btn btn-soft flh-help-btn" id="flhHelp" ${busy||Number(row.hint_level_requested||0)>=4?'disabled':''}>💡 ساعدني</button><button class="btn btn-soft" id="flhLearnExit" ${busy?'disabled':''}>↩ موادي</button></div></section>`);
      document.getElementById('flhLearnExit')?.addEventListener('click',home);
      document.getElementById('flhHelp')?.addEventListener('click',help);
      document.getElementById('flhConfirmAnswer')?.addEventListener('click',()=>selected&&confirmAnswer(selected));
      document.querySelectorAll('.flh-learn-answer').forEach(b=>b.addEventListener('click',()=>choose(b)));
      const ni=queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));if(ni>=0)preloadQuestion(queue[ni]?.question);
      if(session.resumed)session.resumed=false;
    }

    async function choose(btn){
      if(busy)return;
      const row=queue[index],pos=Number(btn.getAttribute('data-pos'));
      if(Number(row.draft_option_position||0)===pos)return;
      row.draft_option_position=pos;
      saveError=false;
      busy=true;
      render();
      try{await call('save_draft',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});}
      catch{row.draft_option_position=null;saveError=true;}
      finally{busy=false;render();}
    }

    async function confirmAnswer(pos){
      if(busy||!pos)return;
      busy=true;saveError=false;render();
      const row=queue[index];
      try{
        const d=await call('answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});
        row.draft_option_position=null;
        if(d.hint_level)row.hint_level_requested=Math.max(Number(row.hint_level_requested||0),Number(d.hint_level));
        if(!d.finalized){
          currentHint=d.hint||null;
          busy=false;
          render();
          const f=document.getElementById('flhLearnFeedback');
          if(f)f.innerHTML='<div class="error">مو هي الإجابة بعد. جرّب جوابًا ثانيًا.</div>';
          return;
        }
        row.status='completed';currentHint=null;
        if(d.remediation_added?.question)queue.push(d.remediation_added);
        busy=false;
        const ni=nextIndex();
        const feedback=`${d.is_correct?'<div class="award-pop flh-child-good">✅ ممتاز!</div>':'<div class="flh-hint-card">💪 خلصنا هذا السؤال. نكمّل سوا.</div>'}${d.explanation?`<div class="flh-explanation"><b>ليش؟</b><div>${renderMath(d.explanation)}</div></div>`:''}<div class="flh-sticky-action"><button class="btn btn-primary flh-next-big" id="flhLearnNext">${ni>=0?'السؤال التالي':'شوف نتيجتي'}</button></div>`;
        qshell(`<section class="panel flh-touch-quiz flh-child-learning"><div class="flh-child-question-head"><b>السؤال ${index+1}</b><span>تم ✓</span></div><div class="question"><b>${renderMath(row.question?.prompt||'')}</b></div>${feedback}</section>`);
        document.getElementById('flhLearnNext')?.addEventListener('click',()=>{if(ni>=0){index=ni;render();}else finish();});
        if(ni>=0)preloadQuestion(queue[ni]?.question);
      }catch{busy=false;saveError=true;render();const f=document.getElementById('flhLearnFeedback');if(f)f.innerHTML='<div class="error">صار خطأ بالحفظ. جرّب مرة ثانية.</div>';}
    }

    async function help(){
      if(busy)return;busy=true;render();const row=queue[index];
      try{
        const d=await call('request_hint',{attempt_id:session.attempt_id,question_id:row.question_id});
        if(d.hint){row.hint_level_requested=Number(d.hint_level||row.hint_level_requested||0);currentHint=d.hint;}
        else if(d.exhausted){row.hint_level_requested=Math.max(4,Number(row.hint_level_requested||0));currentHint={hint_level:4,content:'وصلنا لآخر مساعدة. جرّب تراجع الخطوات اللي أخذناها.'};}
      }catch{currentHint={hint_level:row.hint_level_requested||0,content:'ما قدرت أحمّل المساعدة الآن. جرّب مرة ثانية.'};}
      finally{busy=false;render();}
    }

    render();
  }
  window.FLH=window.FLH||{};window.FLH.startLearningQuiz=startLearningQuiz;
})();
