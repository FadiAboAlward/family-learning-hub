(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/learning-api`;
  const OPTION_LABELS=['A','B','C','D','E','F'];
  const safe=(s='')=>typeof esc==='function'?esc(s):String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizeText=(s='')=>globalThis.FLHContentDirection?.normalizeText?.(s)??String(s);
  const contentAttrs=lang=>globalThis.FLHContentDirection?.attrs?.(lang)||'dir="auto"';
  const questionAttrs=q=>contentAttrs(q?.prompt_language);
  const hintAttrs=(hint,q)=>contentAttrs(hint?.language||q?.prompt_language);
  const renderMath=(s='')=>typeof math==='function'?math(safe(normalizeText(s))):safe(normalizeText(s));
  const hintContentHtml=(s='')=>{const lines=String(s).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);return lines.length===3&&lines.every(x=>/^•\s+\S/u.test(x))?`<ul class="flh-hint-list">${lines.map(x=>`<li>${renderMath(x.replace(/^•\s+/u,''))}</li>`).join('')}</ul>`:renderMath(s);};
  const token=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  const optionLabel=pos=>{const i=Math.max(0,Number(pos)-1);return OPTION_LABELS[i]||(i<26?String.fromCharCode(65+i):String(pos));};
  async function call(action,payload={},signal){const t=token();if(!t)throw new Error('AUTH_REQUIRED');const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${t}`},body:JSON.stringify({action,...payload}),...(signal?{signal}:{})});const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));if(!r.ok){const error=new Error(d.error||'SERVER_ERROR');error.data=d;throw error;}return d;}
  async function refreshProfile(){try{if(typeof api==='function'&&typeof state!=='undefined')state.learnerProfile=await api('student_profile',{},token());}catch{}}
  function preloadQuestion(q){if(!q)return;(q.assets||[]).forEach(a=>{if(a?.url){const img=new Image();img.decoding='async';img.src=a.url;}});}
  function assetsHtml(q){return(q.assets||[]).filter(a=>a?.url).map(a=>`<figure class="flh-q-asset"><img src="${safe(a.url)}" alt="${safe(a.alt_text||'صورة السؤال')}" loading="eager" decoding="async"></figure>`).join('');}
  function home(){if(typeof renderStudentHome==='function'&&typeof state!=='undefined')renderStudentHome(state.learnerProfile);}

  async function openLearningVideos(slug){
    if(!slug||typeof shell!=='function')return;
    globalThis.FLHOptionalVideo?.dispose();
    shell('🎬 جاري تجهيز فيديوهات الدرس','لن نغيّر أي إجابة أو تقدّم محفوظ.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let preview;
    try{preview=await call('preview_videos',{quiz_slug:slug});}
    catch{
      shell('الفيديوهات غير متاحة الآن','يمكنك متابعة التدريب من نفس المكان الذي توقفت عنده.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="flhVideoContinueFallback">متابعة التدريب</button><button class="btn btn-soft" id="flhVideoBackFallback">رجوع لمكتبتي</button></div></section>');
      document.getElementById('flhVideoContinueFallback')?.addEventListener('click',()=>startLearningQuiz(slug));
      document.getElementById('flhVideoBackFallback')?.addEventListener('click',home);
      return;
    }
    const title=preview?.quiz?.title||'فيديوهات الدرس';
    const vshell=html=>shell(`🎬 ${safe(title)}`,'شاهد الدروس بالترتيب، ثم تابع تدريبك المحفوظ متى شئت.',html);
    try{
      if(globalThis.FLHOptionalVideo?.show({
        video:preview.optional_video,
        attemptId:null,
        call,
        renderShell:vshell,
        reportEnabled:false,
        startLabel:'متابعة التدريب',
        onStart:()=>startLearningQuiz(slug),
        onExit:home
      }))return;
    }catch{globalThis.FLHOptionalVideo?.dispose();}
    shell('الفيديوهات غير متاحة الآن','يمكنك متابعة التدريب من نفس المكان الذي توقفت عنده.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="flhVideoContinueFallback">متابعة التدريب</button><button class="btn btn-soft" id="flhVideoBackFallback">رجوع لمكتبتي</button></div></section>');
    document.getElementById('flhVideoContinueFallback')?.addEventListener('click',()=>startLearningQuiz(slug));
    document.getElementById('flhVideoBackFallback')?.addEventListener('click',home);
  }

  async function startLearningQuiz(slug){
    if(!slug||typeof shell!=='function')return;
    globalThis.FLHOptionalVideo?.dispose();
    shell('🧠 جاري تجهيز وضع التعلّم','رح نساعدك خطوة بخطوة.','<section class="panel"><div class="loading-card">لحظة…</div></section>');
    let session;
    try{session=await call('start_quiz',{quiz_slug:slug});}
    catch{shell('تعذر بدء التدريب','هذا التدريب غير متاح لهذا الحساب.','<section class="panel"><div class="actions"><button class="btn btn-primary" id="learnBack">رجوع</button></div></section>');document.getElementById('learnBack')?.addEventListener('click',home);return;}

    const queue=(session.queue||[]).map(x=>({...x}));
    let started=Date.now();
    let index=queue.findIndex(x=>x.status==='active');if(index<0)index=Math.max(0,queue.findIndex(x=>!['completed','skipped'].includes(x.status)));
    let busy=false,currentHint=queue[index]?.last_hint?.content?queue[index].last_hint:null,draftController=null,draftVersion=0;
    const remaining=()=>queue.some(x=>!['completed','skipped'].includes(x.status));
    const nextIndex=()=>queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));
    const qshell=html=>shell(`🧠 ${safe(session.quiz.title)}`,'وضع التعلّم — اختَر، فكّر، واستعمل المساعدة وقت الحاجة.',html);

    async function finish(){
      qshell('<section class="panel"><div class="loading-card">عم نحسب النتيجة من إجاباتك المحفوظة…</div></section>');
      try{
        const d=await call('finish_quiz',{attempt_id:session.attempt_id,duration_seconds:Math.max(1,Math.round((Date.now()-started)/1000))});
        await refreshProfile();
        const review=(d.review||[]).map((r,i)=>`<details class="exam-review"><summary>${r.is_correct===true?'✅':r.is_correct===false?'❌':'📝'} السؤال ${i+1}</summary><div class="question" ${questionAttrs(r)}>${renderMath(r.prompt||'')}</div>${r.explanation?`<div class="muted" dir="auto">${renderMath(r.explanation)}</div>`:''}</details>`).join('');
        const award=d.award?.already_awarded?'<div class="muted">مكافأة هذا التدريب محسوبة سابقًا.</div>':`<div class="award-pop">🎉 +${Number(d.award?.xp||0)} XP &nbsp; 🪙 +${Number(d.award?.reward_points||0)} نقطة</div>`;
        qshell(`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">من أول مرة<b>${Number(d.first_try_correct||0)}</b></div><div class="stat">التلميحات<b>${Number(d.hints_used||0)}</b></div></div>${award}<div class="section-title">مراجعة</div>${review||'<div class="empty">لا توجد مراجعة.</div>'}<div class="flh-sticky-action"><button class="btn btn-primary" id="learnHome">رجوع لمكتبتي</button></div></section>`);
        document.getElementById('learnHome')?.addEventListener('click',home);
      }catch{qshell('<section class="panel"><div class="error">تعذر إنهاء التدريب، لكن إجاباتك المحفوظة لم تضِع.</div><div class="flh-sticky-action"><button class="btn btn-primary" id="learnRetryFinish">إعادة المحاولة</button></div></section>');document.getElementById('learnRetryFinish')?.addEventListener('click',finish);}
    }

    function typedValue(row){return String(row?.draft_response?.value??'')}
    function saveTypedDraft(row){
      const q=row?.question,value=typedValue(row);
      if(!q||!['numeric','short_answer'].includes(q.question_type)||!value.trim())return;
      call('save_response_draft',{attempt_id:session.attempt_id,question_id:row.question_id,response:{value}}).catch(()=>{});
    }

    function render(){
      if(!remaining()||index<0||index>=queue.length)return finish();
      const row=queue[index],q=row?.question;if(!q)return finish();
      const typed=['numeric','short_answer'].includes(q.question_type);
      const selected=Number(row.draft_option_position||0)||null;
      const typedDraft=typedValue(row);
      const opts=typed?'':(q.options||[]).map(o=>{const pos=Number(o.position),sel=pos===selected,label=optionLabel(pos);return`<button class="answer flh-learn-answer ${sel?'selected confirm-ready':''}" data-pos="${pos}" ${busy?'disabled':''}><span class="answer-number">${sel?`✓ ${label}`:label}</span><span>${renderMath(o.content)}</span></button>`}).join('');
      const responseControl=typed?(q.question_type==='numeric'
        ?`<div class="flh-typed-answer"><label for="flhTypedResponse">اكتب الإجابة</label><input id="flhTypedResponse" class="input" inputmode="decimal" autocomplete="off" value="${safe(typedDraft)}" ${busy?'disabled':''}></div>`
        :`<div class="flh-typed-answer"><label for="flhTypedResponse">اكتب إجابتك</label><textarea id="flhTypedResponse" class="input" rows="4" ${busy?'disabled':''}>${safe(typedDraft)}</textarea></div>`)
        :`<div class="answer-grid answer-layout-v8" ${questionAttrs(q)}>${opts}</div>`;
      const restored=session.resumed?'<div class="flh-resume-note">↩️ رجعناك لنفس التدريب، وكل ما حفظته موجود.</div>':'';
      const hintBox=currentHint?.content?`<div class="flh-hint-card"><b>💡 تلميح ${Number(currentHint.hint_level||row.hint_level_requested||1)}</b><div class="flh-hint-content" ${hintAttrs(currentHint,q)}>${hintContentHtml(currentHint.content)}</div></div>`:(Number(row.hint_level_requested||0)>0?`<div class="muted">استخدمت ${Number(row.hint_level_requested)} تلميح/تلميحات سابقًا في هذا السؤال.</div>`:'');
      const misconception=row.misconception_feedback_local;
      const misconceptionBox=misconception?.content?`<div class="flh-misconception-feedback" role="status"><b>ملاحظة تساعدك</b><div ${hintAttrs(misconception,q)}>${renderMath(misconception.content)}</div></div>`:'';
      const hintNotice=row.hint_unavailable_local?'<div class="flh-hint-notice" role="status">المساعدة الإضافية غير متاحة لهذا السؤال الآن. استخدم آخر تلميح ظهر لك وحاول من جديد.</div>':row.hint_error_local?'<div class="flh-hint-notice error" role="status">تعذر تحميل المساعدة الآن. جرّب مرة ثانية بعد قليل.</div>':'';
      const ready=typed?Boolean(typedDraft.trim()):Boolean(selected);
      const status=busy?'جارٍ إرسال الإجابة…':ready?(typed?'الإجابة جاهزة. اضغط «تأكيد الإجابة» عندما تتأكد.':'تم اختيار الإجابة. اضغط «تأكيد الإجابة» عندما تتأكد.'):(typed?'اكتب إجابتك.':'اختر إجابتك.');
      const sourceNote=q.source_metadata?.support_source_derived?'<div class="muted flh-source-note">📚 سؤال من مصدر MEB الداعم الرسمي؛ التلميحات والشرح من Family Learning Hub.</div>':'';
      qshell(`<section class="panel flh-touch-quiz">${restored}<div class="topline"><b>السؤال ${index+1}</b><span class="mode-tag">${row.source_role==='remediation'?'تدريب مساعد':'أساسي'}</span></div>${assetsHtml(q)}<div class="question" ${questionAttrs(q)}><b>${renderMath(q.prompt)}</b></div>${sourceNote}<div class="flh-instruction">${typed?'اكتب إجابتك كما يطلب السؤال، ثم أكّدها.':'اختر جوابك، ثم أكّده عندما تتأكد.'}</div>${responseControl}<div id="flhLearnStatus" class="muted">${status}</div><div class="flh-sticky-action"><button class="btn btn-primary" id="flhConfirmAnswer" ${(!ready||busy)?'disabled':''}>تأكيد الإجابة</button></div><div id="flhLearnHint">${hintBox}${misconceptionBox}${hintNotice}</div><div id="flhLearnFeedback"></div><div class="flh-learning-tools"><button class="btn btn-soft flh-help-btn" id="flhHelp" ${busy||Number(row.hint_level_requested||0)>=4||row.hint_unavailable_local?'disabled':''}>💡 ساعدني</button><button class="btn btn-soft" id="flhLearnExit" ${busy?'disabled':''}>رجوع لمكتبتي</button></div></section>`);
      document.getElementById('flhLearnExit')?.addEventListener('click',home);
      document.getElementById('flhHelp')?.addEventListener('click',help);
      document.getElementById('flhConfirmAnswer')?.addEventListener('click',confirmAnswer);
      document.querySelectorAll('.flh-learn-answer').forEach(b=>b.addEventListener('click',()=>choose(b)));
      const typedInput=document.getElementById('flhTypedResponse');
      typedInput?.addEventListener('input',e=>{row.draft_response={value:e.target.value};const btn=document.getElementById('flhConfirmAnswer');if(btn)btn.disabled=busy||!String(e.target.value||'').trim();});
      typedInput?.addEventListener('blur',()=>saveTypedDraft(row));
      const ni=queue.findIndex((x,i)=>i>index&&!['completed','skipped'].includes(x.status));if(ni>=0)preloadQuestion(queue[ni]?.question);
      if(session.resumed)session.resumed=false;
    }

    function choose(btn){
      if(busy)return;
      const row=queue[index],pos=Number(btn.getAttribute('data-pos'));
      row.draft_option_position=pos;
      render();

      draftVersion++;
      const version=draftVersion;
      draftController?.abort();
      const controller=new AbortController();
      draftController=controller;
      call('save_draft',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos},controller.signal)
        .catch(error=>{
          if(error?.name==='AbortError'||version!==draftVersion||row.status==='completed')return;
          const status=document.getElementById('flhLearnStatus');
          if(status)status.textContent='تم اختيار الإجابة محليًا، لكن تعذر حفظ المسودة الآن. يمكنك التأكيد أو تغيير الاختيار.';
        })
        .finally(()=>{if(draftController===controller)draftController=null;});
    }

    async function confirmAnswer(){
      if(busy)return;
      const row=queue[index],q=row?.question,typed=['numeric','short_answer'].includes(q?.question_type);
      const pos=Number(row.draft_option_position||0),value=typedValue(row);
      if((typed&&!value.trim())||(!typed&&!pos))return;
      draftVersion++;
      draftController?.abort();
      draftController=null;
      busy=true;render();
      try{
        const d=typed
          ?await call('answer_response',{attempt_id:session.attempt_id,question_id:row.question_id,response:{value}})
          :await call('answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:pos});
        row.draft_option_position=null;
        row.draft_response=null;
        if(d.hint_level)row.hint_level_requested=Math.max(Number(row.hint_level_requested||0),Number(d.hint_level));
        if(!d.finalized){
          row.hint_error_local=false;
          const misconceptionOnly=d.hint?.pedagogical_role==='misconception_explanation'&&d.hint?.hint_level==null;
          if(misconceptionOnly){
            row.misconception_feedback_local=d.hint;
            row.hint_unavailable_local=true;
          }else if(d.hint){
            row.misconception_feedback_local=null;
            row.hint_unavailable_local=false;
            currentHint=d.hint;
          }else{
            row.misconception_feedback_local=null;
            row.hint_unavailable_local=true;
          }
          busy=false;render();const f=document.getElementById('flhLearnFeedback');if(f)f.innerHTML='<div class="error">مو هي الإجابة بعد. جرّب من جديد.</div>';return;
        }
        row.status='completed';currentHint=null;if(d.remediation_added?.question)queue.push(d.remediation_added);
        busy=false;
        const ni=nextIndex();
        const feedback=`${d.ungraded?'<div class="award-pop">📝 تم حفظ إجابتك.</div>':d.is_correct?'<div class="award-pop">✅ ممتاز!</div>':'<div class="error">خلصت المحاولات لهذا السؤال.</div>'}${d.explanation?`<div class="flh-explanation"><b>الشرح</b><div dir="auto">${renderMath(d.explanation)}</div></div>`:''}<div class="flh-sticky-action"><button class="btn btn-primary flh-next-big" id="flhLearnNext">${ni>=0?'السؤال التالي':'إنهاء التدريب'}</button></div>`;
        qshell(`<section class="panel flh-touch-quiz"><div class="topline"><b>السؤال ${index+1}</b><span class="mode-tag">تم</span></div><div class="question" ${questionAttrs(row.question)}><b>${renderMath(row.question?.prompt||'')}</b></div>${feedback}</section>`);
        document.getElementById('flhLearnNext')?.addEventListener('click',()=>{if(ni>=0){index=ni;render();}else finish();});
        if(ni>=0)preloadQuestion(queue[ni]?.question);
      }catch{busy=false;render();const f=document.getElementById('flhLearnFeedback');if(f)f.innerHTML='<div class="error">صار خطأ بالحفظ. جرّب مرة ثانية.</div>';}
    }

    async function help(){
      if(busy)return;busy=true;render();const row=queue[index];
      try{
        const d=await call('request_hint',{attempt_id:session.attempt_id,question_id:row.question_id});
        row.hint_error_local=false;
        if(d.hint){
          row.misconception_feedback_local=null;
          row.hint_unavailable_local=false;
          row.hint_level_requested=Number(d.hint_level||row.hint_level_requested||0);
          currentHint=d.hint;
        }else if(d.exhausted){
          row.hint_unavailable_local=true;
        }
      }catch{
        row.hint_error_local=true;
      }finally{busy=false;render();}
    }

    // A resumed question with existing interaction goes straight back to learning.
    const untouched=session.optional_video?.only_before_first_question!==false&&index===0&&queue.length>0&&queue.every(row=>!['completed','skipped'].includes(row.status)&&!row.draft_option_position&&!row.draft_response&&!Number(row.hint_level_requested||0));
    try{if(untouched&&globalThis.FLHOptionalVideo?.show({video:session.optional_video,attemptId:session.attempt_id,call,renderShell:qshell,onStart:()=>{started=Date.now();render();},onExit:home}))return;}catch{globalThis.FLHOptionalVideo?.dispose();}
    render();
  }
  window.FLH=window.FLH||{};
  window.FLH.startLearningQuiz=startLearningQuiz;
  window.FLH.openLearningVideos=openLearningVideos;
})();
