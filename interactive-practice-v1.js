(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const API=`${SUPABASE_URL}/functions/v1/learning-api`;
  const root=document.getElementById('practiceApp');
  const params=new URLSearchParams(location.search);
  const quizSlug=params.get('quiz')||'tr-g4-division-time-interactive-v1';
  const learnerToken=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';
  const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function call(action,payload={}){
    const token=learnerToken();
    if(!token) throw new Error('AUTH_REQUIRED');
    const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload})});
    const d=await r.json().catch(()=>({error:'SERVER_ERROR'}));
    if(!r.ok) throw new Error(d.error||'SERVER_ERROR');
    return d;
  }

  function loginCard(){
    root.innerHTML=`<section class="practice-card empty-card"><div class="practice-title">لازم ندخل بحساب آية أولًا 👧</div><p class="muted">افتحي منصة Family Learning Hub، اختاري آية واكتبي رمز الدخول، وبعدها ارجعي لهذا التدريب.</p><a class="btn btn-primary" href="./#student">دخول الطالب</a></section>`;
  }

  function divisionVisual(m){
    const total=Math.max(0,Number(m.total||0));
    const groups=Math.max(1,Number(m.groups||1));
    const per=Math.floor(total/groups);
    const cards=Array.from({length:groups},(_,g)=>{
      const chips=Array.from({length:per},()=>'<span class="chip" aria-hidden="true"></span>').join('');
      return `<button type="button" class="division-group" data-count="${per}" aria-label="المجموعة ${g+1}"><div class="chips">${chips}</div><div class="group-count">اضغطي لتعدّي</div></button>`;
    }).join('');
    return `<div class="visual" data-visual="division"><div class="visual-title">🟣 وزّعنا ${total} عنصرًا على ${groups} مجموعات متساوية</div><div class="division-grid">${cards}</div></div>`;
  }

  function factVisual(m){
    return `<div class="visual" data-visual="fact"><div class="visual-title">🔁 استعملي العملية العكسية</div><div class="fact-bridge"><div class="fact-box">${esc(m.multiplication||'')}</div><div class="fact-arrow">↔</div><div class="fact-box">${esc(m.division||'')}</div></div></div>`;
  }

  function clockVisual(m){
    const hour=Number(m.hour||0),minute=Number(m.minute||0);
    const hourAngle=((hour%12)+(minute/60))*30;
    const minuteAngle=minute*6;
    const marks=Array.from({length:12},(_,i)=>`<span class="minute-mark" style="transform:translate(-1px,92px) rotate(${i*30}deg)"></span>`).join('');
    return `<div class="visual" data-visual="clock"><div class="visual-title">🕒 اضغطي الساعة إذا بدك علامات إضافية للدقائق</div><div class="clock-wrap"><button type="button" class="clock" aria-label="ساعة عقارب"><span class="clock-number n12">12</span><span class="clock-number n3">3</span><span class="clock-number n6">6</span><span class="clock-number n9">9</span><span class="minute-marks">${marks}</span><span class="hand hour" style="--angle:${hourAngle}deg"></span><span class="hand minute" style="--angle:${minuteAngle}deg"></span></button></div></div>`;
  }

  function timelineVisual(m){
    return `<button type="button" class="visual" data-visual="timeline"><div class="visual-title">⏱️ خطّ الزمن — اضغطيه لتحصلي على طريقة التفكير</div><div class="timeline"><span class="time-pill">${esc(m.start||'')}</span><span class="timeline-line"></span><span class="time-pill">${esc(m.end||'')}</span></div><div class="timeline-help">قسّمي المدة إلى قفزات سهلة: إلى الساعة التالية أولًا، ثم إلى وقت النهاية.</div></button>`;
  }

  function conversionVisual(m){
    const h=Math.max(0,Number(m.hours||0)),mins=Math.max(0,Number(m.minutes||0));
    const hours=Array.from({length:h},()=>'<span class="time-tile">1 saat</span>').join('');
    return `<button type="button" class="visual" data-visual="conversion"><div class="visual-title">⏰ اضغطي لتتذكري قاعدة التحويل</div><div class="conversion-row">${hours}${mins?`<span class="time-tile">${mins} dakika</span>`:''}</div><div class="conversion-help">1 saat = 60 dakika</div></button>`;
  }

  function visualHtml(q){
    const m=q?.source_metadata||{};
    switch(m.activity_kind){
      case 'division_groups': return divisionVisual(m);
      case 'fact_bridge': return factVisual(m);
      case 'analog_clock': return clockVisual(m);
      case 'elapsed_timeline': return timelineVisual(m);
      case 'time_conversion': return conversionVisual(m);
      default: return '';
    }
  }

  function bindVisuals(){
    document.querySelectorAll('.division-group').forEach(btn=>btn.addEventListener('click',()=>{
      const on=btn.classList.toggle('counted');
      const label=btn.querySelector('.group-count');
      if(label) label.textContent=on?`${btn.dataset.count} عناصر`:'اضغطي لتعدّي';
    }));
    document.querySelector('.clock')?.addEventListener('click',e=>e.currentTarget.classList.toggle('show-marks'));
    document.querySelectorAll('[data-visual="timeline"],[data-visual="conversion"]').forEach(v=>v.addEventListener('click',()=>v.classList.toggle('revealed')));
  }

  let session=null;
  let queue=[];
  let index=0;
  let selected=null;
  let busy=false;
  let currentHint=null;
  const startedAt=Date.now();

  function currentRow(){return queue[index]||null;}
  function isDone(row){return !row||['completed','skipped'].includes(row.status);}
  function findNext(){for(let i=index+1;i<queue.length;i++) if(!isDone(queue[i])) return i; return -1;}
  function completedCount(){return queue.filter(isDone).length;}

  function renderQuestion(message=''){
    const row=currentRow();
    if(!row?.question) return finishQuiz();
    const q=row.question;
    const total=Math.max(1,queue.filter(x=>x.source_role!=='remediation'||!isDone(x)).length);
    const progress=Math.min(100,Math.round((completedCount()/Math.max(1,queue.length))*100));
    const options=(q.options||[]).map(o=>{
      const pos=Number(o.position),isSelected=selected===pos;
      return `<button type="button" class="answer ${isSelected?'selected':''}" data-answer="${pos}" ${busy?'disabled':''}><span class="answer-index">${isSelected?'✓':pos}</span><span>${esc(o.content)}</span></button>`;
    }).join('');
    root.innerHTML=`<section class="practice-card"><div class="practice-head"><div><div class="practice-title">🧠 ${esc(session.quiz.title)}</div><div class="muted">${row.source_role==='remediation'?'تدريب مساعد لنفس الفكرة':'تحدّي أساسي'} · سؤال ${index+1}</div></div><a class="btn btn-soft" href="./#student">خروج</a></div><div class="progress"><span style="width:${progress}%"></span></div>${visualHtml(q)}<div class="question"><b>${esc(q.prompt)}</b></div><div class="answers">${options}</div><div class="status">${message||(!selected?'اختاري جوابًا، وبعدها اضغطي تأكيد.':'اختيارك محفوظ محليًا؛ أكّديه عندما تتأكدي.')}</div>${currentHint?.content?`<div class="hint"><b>💡 تلميح ${Number(currentHint.hint_level||1)}</b><div>${esc(currentHint.content)}</div></div>`:''}<div class="toolbar"><button class="btn btn-primary" id="confirmAnswer" ${busy||!selected?'disabled':''}>تأكيد الإجابة</button><button class="btn btn-soft" id="askHint" ${busy?'disabled':''}>💡 ساعدني</button></div></section>`;
    bindVisuals();
    document.querySelectorAll('[data-answer]').forEach(btn=>btn.addEventListener('click',()=>choose(Number(btn.dataset.answer))));
    document.getElementById('confirmAnswer')?.addEventListener('click',confirmAnswer);
    document.getElementById('askHint')?.addEventListener('click',askHint);
  }

  async function choose(pos){
    if(busy) return;
    selected=pos;
    renderQuestion('عم نحفظ اختيارك…');
    busy=true;
    try{await call('save_draft',{attempt_id:session.attempt_id,question_id:currentRow().question_id,option_position:pos});}
    catch{selected=null;}
    finally{busy=false;renderQuestion(selected?'اختيارك محفوظ.':'ما قدرنا نحفظ الاختيار؛ جرّبي مرة ثانية.');}
  }

  async function askHint(){
    if(busy) return;
    busy=true;renderQuestion('عم نجهّز تلميحًا صغيرًا…');
    try{
      const row=currentRow();
      const d=await call('request_hint',{attempt_id:session.attempt_id,question_id:row.question_id});
      if(d.hint) currentHint=d.hint;
      else currentHint={hint_level:d.hint_level||4,content:'جرّبي تقسيم المسألة إلى خطوة أصغر، ثم ارجعي للجواب.'};
    }catch{currentHint={hint_level:1,content:'تعذر تحميل التلميح الآن. جرّبي مرة ثانية.'};}
    finally{busy=false;renderQuestion();}
  }

  async function confirmAnswer(){
    if(busy||!selected) return;
    busy=true;renderQuestion('عم نتحقق من الإجابة…');
    const row=currentRow();
    try{
      const d=await call('answer',{attempt_id:session.attempt_id,question_id:row.question_id,option_position:selected});
      if(!d.finalized){
        selected=null;
        if(d.hint) currentHint=d.hint;
        busy=false;
        renderQuestion('مو هي الإجابة بعد 🙂 جرّبي مرة ثانية.');
        return;
      }
      row.status='completed';
      if(d.remediation_added?.question) queue.push(d.remediation_added);
      selected=null;currentHint=null;busy=false;
      const next=findNext();
      root.innerHTML=`<section class="practice-card"><div class="feedback ${d.is_correct?'good':'bad'}"><b>${d.is_correct?'✅ ممتاز! فهمتي الفكرة.':'🌱 خلصت محاولات هذا السؤال، ومنكمل نتدرّب.'}</b>${d.explanation?`<div>${esc(d.explanation)}</div>`:''}</div><div class="toolbar"><button class="btn btn-primary" id="nextQuestion">${next>=0?'السؤال التالي':'شوفي النتيجة'}</button></div></section>`;
      document.getElementById('nextQuestion')?.addEventListener('click',()=>{if(next>=0){index=next;renderQuestion();}else finishQuiz();});
    }catch{
      busy=false;renderQuestion('صار خطأ بالحفظ، وإجابتك ما ضاعت. جرّبي التأكيد مرة ثانية.');
    }
  }

  async function finishQuiz(){
    root.innerHTML='<section class="practice-card loading-card">عم نجمع نتيجتك ونحفظ التقدّم…</section>';
    try{
      const d=await call('finish_quiz',{attempt_id:session.attempt_id,duration_seconds:Math.max(1,Math.round((Date.now()-startedAt)/1000))});
      const review=(d.review||[]).map((r,i)=>`<div class="review"><b>${r.is_correct?'✅':'❌'} سؤال ${i+1}</b><div>${esc(r.prompt||'')}</div>${r.explanation?`<div class="muted">${esc(r.explanation)}</div>`:''}</div>`).join('');
      root.innerHTML=`<section class="practice-card"><div class="practice-title">🎉 خلص التدريب!</div><p class="muted">النتيجة انحفظت على حساب الطالب، ومعها أدلة الإتقان لكل مفهوم.</p><div class="finish-stats"><div class="stat">الدرجة<b>${Number(d.percentage||0)}%</b></div><div class="stat">صح من أول مرة<b>${Number(d.first_try_correct||0)}</b></div><div class="stat">التلميحات<b>${Number(d.hints_used||0)}</b></div></div>${review}<div class="toolbar"><a class="btn btn-primary" href="./#student">رجوع للمكتبة</a><button class="btn btn-soft" id="repeatPractice">أتمرّن مرة ثانية</button></div></section>`;
      document.getElementById('repeatPractice')?.addEventListener('click',()=>location.reload());
    }catch{
      root.innerHTML='<section class="practice-card"><div class="feedback bad">تعذر إنهاء التدريب الآن، لكن الإجابات التي تم إرسالها محفوظة في السيرفر.</div><button class="btn btn-primary" id="retryFinish">إعادة محاولة الحفظ النهائي</button></section>';
      document.getElementById('retryFinish')?.addEventListener('click',finishQuiz);
    }
  }

  async function start(){
    if(!learnerToken()) return loginCard();
    try{
      session=await call('start_quiz',{quiz_slug:quizSlug});
      queue=(session.queue||[]).map(x=>({...x}));
      index=queue.findIndex(x=>x.status==='active');
      if(index<0) index=queue.findIndex(x=>!isDone(x));
      if(index<0) return finishQuiz();
      selected=Number(queue[index].draft_option_position||0)||null;
      renderQuestion(session.resumed?'↩️ رجعناك لنفس المكان؛ إجاباتك السابقة محفوظة.':'اضغطي على الشكل وجربي بنفسك قبل الجواب.');
    }catch(err){
      if(String(err?.message)==='AUTH_REQUIRED'||String(err?.message)==='SESSION_EXPIRED'||String(err?.message)==='INVALID_SESSION') return loginCard();
      root.innerHTML=`<section class="practice-card empty-card"><div class="practice-title">ما قدرنا نفتح التدريب</div><p class="muted">قد يكون التدريب غير متاح لهذا الحساب بعد.</p><a class="btn btn-primary" href="./#student">رجوع للمنصة</a></section>`;
    }
  }

  start();
})();
