const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
const FAMILY_API = `${SUPABASE_URL}/functions/v1/family-api`;
const app = document.getElementById('app');

const state = { learnerSession: localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '', learnerProfile: null, parentSession: loadJson('parent_session'), selectedLearner: null };

function loadJson(k){ try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null} }
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function frac(n,d){return `<span class="frac"><span class="n">${n}</span><span class="d">${d}</span></span>`}
function math(s){return String(s).replace(/(\d+)\/(\d+)/g,(_,n,d)=>frac(n,d))}
function errorText(code){
  const map={INVALID_LOGIN:'الاسم أو الرمز غير صحيح.',INVALID_OR_USED_INVITE:'رمز دعوة الأهل غير صحيح أو تم استخدامه.',PARENT_ACCOUNT_LIMIT:'تم إنشاء حسابَي الأهل المسموحين.',INVALID_REGISTRATION:'تأكد من البريد وكلمة المرور ورمز الدعوة.',CREATE_PARENT_FAILED:'تعذر إنشاء الحساب. جرّب بريدًا آخر أو كلمة مرور أقوى.',INVALID_PARENT_SESSION:'انتهت جلسة الدخول. سجل الدخول من جديد.',NOT_A_PARENT_MEMBER:'هذا الحساب غير مرتبط بالعائلة.'};
  return map[code]||'صار خطأ بسيط. جرّب مرة ثانية.';
}
async function api(action,payload={},token=''){
  const headers={'content-type':'application/json','apikey':PUBLISHABLE_KEY};
  if(token) headers.authorization=`Bearer ${token}`;
  const r=await fetch(FAMILY_API,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  const data=await r.json().catch(()=>({error:'SERVER_ERROR'}));
  if(!r.ok) throw Object.assign(new Error(data.error||'SERVER_ERROR'),{data,status:r.status});
  return data;
}
async function parentPasswordLogin(email,password){
  const r=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY},body:JSON.stringify({email,password})});
  const d=await r.json(); if(!r.ok) throw new Error('LOGIN_FAILED'); return d;
}
async function refreshParent(){
  if(!state.parentSession?.refresh_token) return false;
  const r=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY},body:JSON.stringify({refresh_token:state.parentSession.refresh_token})});
  if(!r.ok) return false; state.parentSession=await r.json(); localStorage.setItem('parent_session',JSON.stringify(state.parentSession)); return true;
}
function shell(title,subtitle,content){
  app.innerHTML=`<section class="hero"><h1>${title}</h1><p>${subtitle}</p></section>${content}<div class="footer-links"><a href="#student">دخول الطالب</a><a href="#parents">دخول الأهل</a></div>`;
}
function landing(){
  shell('🎓 منصة التعلّم العائلية','دراسة، تحديات، نقاط، ومتابعة واضحة للأهل.',`<section class="panel"><div class="choice-grid"><button class="role-card" id="studentRole"><span class="big-emoji">🧑‍🎓</span><div class="title">أنا طالب</div><div class="muted">أدخل لحسابي وأكمل تعلّمي.</div></button><button class="role-card" id="parentRole"><span class="big-emoji">👨‍👩‍👧‍👦</span><div class="title">دخول الأهل</div><div class="muted">متابعة آية ومحمد والنتائج والمكافآت.</div></button></div></section>`);
  studentRole.onclick=()=>{location.hash='student'}; parentRole.onclick=()=>{location.hash='parents'};
}
async function studentRoute(){
  if(state.learnerSession){
    try{ const p=await api('student_profile',{},state.learnerSession); state.learnerProfile=p; return renderStudentHome(p); }
    catch{ localStorage.removeItem('learner_session');sessionStorage.removeItem('learner_session');state.learnerSession=''; }
  }
  renderStudentLogin();
}
function renderStudentLogin(){
  shell('🧑‍🎓 دخول الطالب','اختَر اسمك، ثم اكتب رمزك.',`<section class="panel"><div class="choice-grid"><button class="profile-card" data-slug="aya"><span class="big-emoji">🌷</span><div class="title">آية</div></button><button class="profile-card" data-slug="mohammad"><span class="big-emoji">🚀</span><div class="title">محمد</div></button></div><div id="pinArea"></div><div class="actions"><button class="btn btn-soft" id="backHome">رجوع</button></div></section>`);
  document.querySelectorAll('[data-slug]').forEach(b=>b.onclick=()=>showPin(b.dataset.slug,b.querySelector('.title').textContent));
  backHome.onclick=()=>{location.hash=''};
}
function showPin(slug,name){
  state.selectedLearner=slug;
  pinArea.innerHTML=`<div class="field"><label>رمز ${esc(name)}</label><input id="studentPin" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="8 أرقام" /></div><label class="muted"><input type="checkbox" id="rememberLearner" checked /> تذكرني على هذا الجهاز</label><div class="actions"><button class="btn btn-primary" id="studentLoginBtn">دخول</button></div><div id="studentMsg"></div>`;
  studentLoginBtn.onclick=async()=>{
    studentLoginBtn.disabled=true; studentMsg.innerHTML='';
    try{const d=await api('student_login',{slug,pin:studentPin.value}); state.learnerSession=d.session; state.learnerProfile=d.profile; const store=rememberLearner.checked?localStorage:sessionStorage; store.setItem('learner_session',d.session); renderStudentHome(d.profile)}
    catch(e){studentMsg.innerHTML=`<div class="error">${errorText(e.message)}</div>`;studentLoginBtn.disabled=false}
  };
}
function levelProgress(g){
  const cur=g.current_level_info, next=g.next_level_info; if(!next||!cur)return 100;
  const span=Math.max(1,Number(next.min_xp)-Number(cur.min_xp)); return Math.max(0,Math.min(100,Math.round((Number(g.xp)-Number(cur.min_xp))/span*100)));
}
function renderStudentHome(p){
  const l=p.learner,g=p.gamification,level=g.current_level_info||{icon:'🌱',name:'مستكشف'};
  const badges=(g.badges||[]).length?(g.badges||[]).map(x=>`<div class="badge"><div class="icon">${esc(x.badge?.icon||'🏅')}</div><b>${esc(x.badge?.title||'وسام')}</b><div class="muted">${esc(x.award_reason||'')}</div></div>`).join(''):`<div class="empty">أول وسام لسه بالطريق 🏅</div>`;
  const rewards=(g.rewards||[]).length?(g.rewards||[]).map(r=>`<div class="reward-card"><b>🎁 ${esc(r.title)}</b><div class="muted">${r.required_reward_points?`${r.required_reward_points} نقطة`:''}${r.required_level?` · مستوى ${r.required_level}`:''}</div></div>`).join(''):`<div class="empty">الأهل لسه ما أضافوا مكافآت حقيقية. أول ما يضيفوا رحلة أو نشاط رح يظهر هون 🎁</div>`;
  shell(`أهلًا ${esc(l.display_name)} 👋`,`${level.icon||'🌱'} ${esc(level.name||'مستكشف')} — كل خطوة صغيرة محسوبة.`,`<section class="panel"><div class="topline"><b>تقدّمك</b><button class="btn btn-soft" id="studentLogout">تبديل الطالب</button></div><div class="stats"><div class="stat">⭐ XP<b>${g.xp||0}</b></div><div class="stat">🪙 نقاط<b>${g.reward_points||0}</b></div><div class="stat">🔥 سلسلة<b>${g.current_streak||0}</b></div><div class="stat">🏅 أوسمة<b>${(g.badges||[]).length}</b></div></div><div class="section-title">للمستوى التالي</div><div class="progress"><span style="width:${levelProgress(g)}%"></span></div><div class="muted">${g.next_level_info?`باقي ${g.xp_to_next} XP إلى ${esc(g.next_level_info.name)}`:'وصلت أعلى مستوى الحالي 🎉'}</div></section><section class="panel"><div class="section-title">📘 كويزاتك</div><button class="quiz-card" id="fractionQuiz"><b>الكسور (1)</b><div class="muted">مقارنة وترتيب الكسور — الصفحات 55–57</div></button><div class="section-title">🏅 أوسمتك</div><div class="badge-row">${badges}</div><div class="section-title">🎁 المكافآت</div><div class="choice-grid">${rewards}</div></section>`);
  studentLogout.onclick=()=>{localStorage.removeItem('learner_session');sessionStorage.removeItem('learner_session');state.learnerSession='';renderStudentLogin()};
  fractionQuiz.onclick=()=>startQuiz();
}

const QUIZ=[
 {id:'q1',c:'الكسور المتكافئة',d:2,q:'أي كسر يكافئ 3/8؟',a:['6/16','3/16','6/8','8/16','9/16'],ok:0,why:['','غيّرت المقام وحده.','غيّرت البسط وحده.','8/16 يساوي 1/2.','9/16 أكبر من 3/8.'],h:[
  ['🔁 الكسر المكافئ له نفس القيمة.','✖️ نفس العملية فوق وتحت.','👀 دور على خيار ناتج من نفس التغيير.'],
  ['🧩 لا تغيّر رقمًا واحدًا فقط.','✖️ اضرب البسط والمقام بنفس العدد.','🔎 افحص الخيارات بهدوء.'],
  ['🧮 جرّب عددًا صغيرًا للضرب.','↕️ طبّقه فوق وتحت.','✅ قارِن الناتج بالخيارات.'],
  ['🪜 اعمل خطوة واحدة كل مرة.','✖️ نفس الضرب للبسط والمقام.','🎯 اختر الناتج المطابق.']],x:[
  ['1) تخيّل نفس قطعة الشوكولا.','2) تقسيمها أكثر لا يغيّر الكمية.','3) البسط والمقام يتغيران معًا.','4) استخدم نفس عدد الضرب.','5) جرّب على 3 وعلى 8.','6) قارن الناتج بالخيارات.'],
  ['1) ثبّت قيمة الكسر.','2) لا تغيّر المقام وحده.','3) لا تغيّر البسط وحده.','4) اختر عدد ضرب واحدًا.','5) طبقه على الرقمين.','6) افحص الناتج.'],
  ['1) اختر ضربًا بسيطًا.','2) اضرب البسط.','3) اضرب المقام بنفس العدد.','4) اكتب الكسر الجديد.','5) لا تحسب شيئًا إضافيًا.','6) ابحث عنه بين الخيارات.'],
  ['1) ابدأ من 3 و8.','2) اختر نفس عامل الضرب.','3) طبقه على 3.','4) طبقه على 8.','5) كوّن الكسر.','6) طابقه مع خيار واحد.']],good:'ممتاز! نفس العملية على البسط والمقام تعطي كسرًا مكافئًا.'},
 {id:'q2',c:'مقارنة الكسور',d:3,q:'أي علاقة صحيحة بين 2/5 و1/3؟',a:['2/5 > 1/3','2/5 < 1/3','2/5 = 1/3','لا يمكن المقارنة','المقام الأكبر يعني الكسر أكبر'],ok:0,why:['','المقامات المختلفة ممكن تخدعنا.','الكسران مو متساويين.','نقدر نقارن بعد توحيد المقام.','المقام الأكبر لا يعني كسرًا أكبر.'],h:[
  ['⚖️ خَلّي الأجزاء من نفس النوع.','🔢 ابحث عن مقام مشترك.','👀 بعدها قارن البسطين.'],
  ['🧱 المقام المشترك يوحّد حجم القطع.','🔁 حوّل الكسرين بدون تغيير قيمتهما.','📏 قارن بعد التوحيد.'],
  ['🧮 اشتغل على المقامين أولًا.','↕️ لا تنسَ البسط مع المقام.','🔎 المقارنة تصير أسهل بعدها.'],
  ['🪜 وحّد، ثم قارن.','👀 لا تحكم من المقام وحده.','🎯 اختر العلاقة الناتجة.']],x:[
  ['1) المقامات مختلفة.','2) لذلك حجم الأجزاء مختلف.','3) نريد أجزاء من نفس الحجم.','4) نبحث عن مقام مشترك.','5) نكتب كسرين مكافئين.','6) نقارن البسطين.'],
  ['1) اختر مقامًا مشتركًا.','2) حدّد كيف يصل إليه الكسر الأول.','3) غيّر بسطه بنفس النسبة.','4) افعل الشيء نفسه للثاني.','5) صار المقام متساويًا.','6) قارن البسط.'],
  ['1) ابدأ بالمقامين.','2) لا تقارن مباشرة.','3) وحّد المقام.','4) حافظ على قيمة كل كسر.','5) انظر للبسطين.','6) الأكبر بسطًا هو الأكبر عند نفس المقام.'],
  ['1) المقام ليس الحكم وحده.','2) وحّد المقامين.','3) حافظ على التكافؤ.','4) اكتب القيم الجديدة.','5) قارنها.','6) اختر الإشارة المناسبة.']],good:'صحيح! بعد توحيد المقامات تصبح المقارنة واضحة.'},
 {id:'q3',c:'ترتيب الكسور',d:4,adaptive:true,q:'أي ترتيب تصاعدي صحيح: 3/4 ، 1/3 ، 5/6 ، 7/12 ؟',a:['1/3 < 7/12 < 3/4 < 5/6','7/12 < 1/3 < 3/4 < 5/6','1/3 < 3/4 < 7/12 < 5/6','5/6 < 3/4 < 7/12 < 1/3','3/4 < 7/12 < 1/3 < 5/6'],ok:0,why:['','البداية ليست من الأصغر.','راجع مكان 7/12 و3/4.','هذا ترتيب من الأكبر للأصغر تقريبًا.','3/4 ليس الأصغر.'],h:[
  ['🪜 تصاعدي = من الأصغر للأكبر.','🧮 وحّد المقامات.','👣 بعدها رتّب البسوط.'],
  ['🔢 استخدم مقامًا يناسب الأربعة.','🧱 اجعل كل الكسور بنفس المقام.','👀 رتّب الأرقام فوق الخط.'],
  ['🪜 لا تقارن الأربعة دفعة واحدة.','🔁 حوّلها أولًا.','📏 رتّب بعد التوحيد.'],
  ['🎯 ابدأ بالأصغر.','🧮 المقام المشترك هو المفتاح.','👣 ثم امشِ للأكبر.']],x:[
  ['1) معنى تصاعدي: الأصغر أولًا.','2) المقامات مختلفة.','3) نختار مقامًا مشتركًا.','4) نحوّل كل كسر.','5) نرتب البسوط.','6) نعيد الترتيب للكسور الأصلية.'],
  ['1) ابحث عن مقام مشترك.','2) حوّل الكسر الأول.','3) حوّل الثاني.','4) حوّل الثالث والرابع.','5) اكتب البسوط فقط.','6) رتبها من الأصغر للأكبر.'],
  ['1) قسم المهمة لخطوات.','2) وحّد المقامات.','3) لا تغيّر قيمة الكسور.','4) ركّز على البسوط.','5) رتبها.','6) طابقها مع الخيار.'],
  ['1) لا تبدأ بالتخمين.','2) وحّد المقامات.','3) تأكد أن كل كسر مكافئ للأصلي.','4) رتب البسوط.','5) اقرأ الترتيب من اليمين لليسار بحذر.','6) اختر التسلسل المطابق.']],good:'رائع! توحيد المقامات يجعل ترتيب الكسور أسهل.'}
];
function startQuiz(){
  const qs=QUIZ.map(q=>({...q,role:'core'})); let qi=0,attempt=1,sel=null,wrong=0,results=[],hintCount=0,firstTry=0;
  function renderQ(){
    const q=qs[qi];attempt=1;sel=null;wrong=0;
    shell('🎯 كويز الكسور','شرح بسيط خطوة بخطوة. خذ Hint إذا احتجت.',`<section class="card"><div class="quiz-head"><span>${q.role==='remediation'?'🔁 سؤال تثبيت':`السؤال ${Math.min(qi+1,QUIZ.length)} من ${QUIZ.length}`}</span><span>الصعوبة ${q.d}/5</span></div><div class="question">${math(q.q)}</div><div class="answers" id="answers">${q.a.map((a,n)=>`<button class="answer" data-n="${n}">${math(a)}</button>`).join('')}</div><div id="quizFeedback"></div><div class="actions"><button id="checkAnswer" class="btn btn-primary" disabled>تحقّق</button><button id="quitQuiz" class="btn btn-soft">رجوع</button></div></section>`);
    document.querySelectorAll('.answer').forEach(b=>b.onclick=()=>{document.querySelectorAll('.answer').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');sel=Number(b.dataset.n);checkAnswer.disabled=false});
    quitQuiz.onclick=()=>renderStudentHome(state.learnerProfile);
    checkAnswer.onclick=()=>check(q);
  }
  function stepList(arr){return `<ol class="steps">${arr.map(x=>`<li>${math(String(x).replace(/^\d+\)\s*/,''))}</li>`).join('')}</ol>`}
  function check(q){
    if(sel===q.ok){
      if(attempt===1) firstTry++;
      const score=[100,75,50,25][attempt-1]||0; results.push(score);
      quizFeedback.innerHTML=`<div class="feedback good">🎉 ${math(q.good)}</div>`; document.querySelectorAll('.answer').forEach(b=>b.disabled=true);checkAnswer.style.display='none';
      const next=document.createElement('button');next.className='btn btn-soft';next.textContent='السؤال التالي ➜';next.onclick=()=>{qi++; if(qi>=qs.length) finish(); else renderQ()};document.querySelector('.actions').appendChild(next);return;
    }
    wrong++;hintCount++;const level=Math.min(attempt-1,3);quizFeedback.innerHTML=`<div class="feedback bad">🙂 قريب. ${math(q.why[sel]||'جرّب من زاوية ثانية.')}</div><div class="hint-box"><b>💡 Hint ${attempt}/4</b>${stepList(q.h[level])}<button class="btn btn-warning" id="moreHint">🧠 اشرحلي نفس الهينت أكتر</button></div><div id="moreArea"></div>${q.adaptive&&wrong===3?'<div class="award-pop">🔁 بعد هذا السؤال رح يجي سؤال تثبيت من نفس الفكرة.</div>':''}`;
    moreHint.onclick=()=>{moreArea.innerHTML=`<div class="more-box"><b>🔍 نفس الفكرة، شرح أوسع:</b>${stepList(q.x[level])}</div>`};
    document.querySelectorAll('.answer').forEach(b=>b.classList.remove('selected'));sel=null;attempt++;checkAnswer.disabled=true;
    if(attempt>4){results.push(0);document.querySelectorAll('.answer').forEach(b=>b.disabled=true);checkAnswer.style.display='none';quizFeedback.innerHTML+=`<div class="feedback bad">🧠 خلّينا نوقف التخمين. ${math(q.good)}</div>`;const next=document.createElement('button');next.className='btn btn-soft';next.textContent='كمل';next.onclick=()=>{qi++;if(qi>=qs.length)finish();else renderQ()};document.querySelector('.actions').appendChild(next)}
  }
  async function finish(){
    const core=results.slice(0,QUIZ.length);const score=Math.round(core.reduce((a,b)=>a+b,0)/Math.max(1,core.length));
    shell('📊 خلص الكويز!',`درجتك التعليمية ${score}% — الأهم إننا عرفنا كيف وصلت للإجابة.`,`<section class="panel"><div class="stats"><div class="stat">الدرجة<b>${score}%</b></div><div class="stat">من أول مرة<b>${firstTry}/${QUIZ.length}</b></div><div class="stat">Hints<b>${hintCount}</b></div><div class="stat">الحالة<b>محفوظة</b></div></div><div id="awardArea"><div class="muted">عم نحفظ النتيجة ونحسب XP…</div></div><div class="actions"><button class="btn btn-primary" id="homeAfterQuiz">رجوع لصفحتي</button></div></section>`);
    homeAfterQuiz.onclick=()=>renderStudentHome(state.learnerProfile);
    try{const d=await api('complete_quiz',{quiz_slug:'fractions-pages-54-57',score,first_try_correct:firstTry,hints_used:hintCount},state.learnerSession);state.learnerProfile=d.profile;awardArea.innerHTML=d.already_awarded?`<div class="award-pop">✅ النتيجة انحفظت. XP لهذا الكويز محسوب من أول إكمال، حتى ما نجمع نقاط بتكراره.</div>`:`<div class="award-pop">🎉 +${d.award.xp} XP &nbsp; 🪙 +${d.award.reward_points} نقطة${d.award.badges?.length?`<br>🏅 أوسمة جديدة: ${d.award.badges.length}`:''}</div>`}
    catch{awardArea.innerHTML='<div class="error">النتيجة ظاهرة عندك، لكن صار خطأ بالحفظ. جرّب لاحقًا.</div>'}
  }
  renderQ();
}

async function parentRoute(){
  if(state.parentSession?.access_token){
    try{return await renderParentDashboard()}
    catch(e){if(e.status===401 && await refreshParent()){try{return await renderParentDashboard()}catch{}} localStorage.removeItem('parent_session');state.parentSession=null}
  }
  renderParentLogin('login');
}
function renderParentLogin(tab='login'){
  shell('👨‍👩‍👧‍👦 دخول الأهل','الأب والأم لكل واحد حسابه، والاثنان يشاهدان نفس لوحة العائلة.',`<section class="panel"><div class="tabs"><button id="loginTab" class="tab ${tab==='login'?'active':''}">تسجيل الدخول</button><button id="registerTab" class="tab ${tab==='register'?'active':''}">إنشاء حساب ولي أمر</button></div><div id="parentForm"></div><div class="actions"><button class="btn btn-soft" id="parentBack">رجوع</button></div></section>`);
  loginTab.onclick=()=>renderParentLogin('login');registerTab.onclick=()=>renderParentLogin('register');parentBack.onclick=()=>{location.hash=''};
  if(tab==='login') parentForm.innerHTML=`<div class="field"><label>البريد الإلكتروني</label><input id="pEmail" type="email" autocomplete="email"></div><div class="field"><label>كلمة المرور</label><input id="pPass" type="password" autocomplete="current-password"></div><div class="actions"><button class="btn btn-primary" id="parentLoginBtn">دخول</button></div><div id="parentMsg"></div>`;
  else parentForm.innerHTML=`<div class="field"><label>أنا</label><select id="pRelation"><option value="father">الأب</option><option value="mother">الأم</option></select></div><div class="field"><label>البريد الإلكتروني</label><input id="pEmail" type="email"></div><div class="field"><label>كلمة المرور (8 أحرف أو أكثر)</label><input id="pPass" type="password"></div><div class="field"><label>رمز دعوة ولي الأمر</label><input id="pInvite" autocomplete="one-time-code"></div><div class="actions"><button class="btn btn-primary" id="parentRegisterBtn">إنشاء الحساب</button></div><div id="parentMsg"></div>`;
  if(tab==='login') parentLoginBtn.onclick=async()=>{parentLoginBtn.disabled=true;try{state.parentSession=await parentPasswordLogin(pEmail.value.trim(),pPass.value);localStorage.setItem('parent_session',JSON.stringify(state.parentSession));await renderParentDashboard()}catch{parentMsg.innerHTML='<div class="error">البريد أو كلمة المرور غير صحيحة.</div>';parentLoginBtn.disabled=false}};
  else parentRegisterBtn.onclick=async()=>{parentRegisterBtn.disabled=true;try{await api('parent_register',{email:pEmail.value.trim(),password:pPass.value,invite_code:pInvite.value.trim(),relation:pRelation.value});state.parentSession=await parentPasswordLogin(pEmail.value.trim(),pPass.value);localStorage.setItem('parent_session',JSON.stringify(state.parentSession));await renderParentDashboard()}catch(e){parentMsg.innerHTML=`<div class="error">${errorText(e.message)}</div>`;parentRegisterBtn.disabled=false}};
}
async function renderParentDashboard(){
  const d=await api('parent_dashboard',{},state.parentSession.access_token);const byState=Object.fromEntries((d.states||[]).map(s=>[s.learner_id,s]));
  const cards=(d.learners||[]).map(l=>{const s=byState[l.id]||{};const att=(d.attempts||[]).filter(a=>a.learner_id===l.id);const last=att[0];return `<div class="card"><div class="topline"><b>${esc(l.display_name)}</b><span>${s.current_level?'Level '+s.current_level:'Level 1'}</span></div><div class="stats"><div class="stat">⭐ XP<b>${s.xp||0}</b></div><div class="stat">🪙 نقاط<b>${s.reward_points||0}</b></div><div class="stat">🔥 سلسلة<b>${s.current_streak||0}</b></div><div class="stat">آخر نتيجة<b>${last?.percentage!=null?Math.round(last.percentage)+'%':'—'}</b></div></div></div>`}).join('');
  const rows=(d.attempts||[]).map(a=>{const l=(d.learners||[]).find(x=>x.id===a.learner_id);return `<tr><td>${esc(l?.display_name||'طالب')}</td><td>${a.percentage!=null?Math.round(a.percentage)+'%':'—'}</td><td>${a.metadata?.first_try_correct??'—'}</td><td>${a.metadata?.hints_used??'—'}</td><td>${a.submitted_at?new Date(a.submitted_at).toLocaleDateString('ar'):'—'}</td></tr>`}).join('')||'<tr><td colspan="5">لا توجد نتائج محفوظة بعد.</td></tr>';
  shell('📊 لوحة الأهل',`مرحبًا — الحساب: ${esc(d.parent.relation==='mother'?'الأم':d.parent.relation==='father'?'الأب':'ولي أمر')}.`,`<section>${cards}</section><section class="panel"><div class="topline"><b>تفاصيل المحاولات</b><button class="btn btn-soft" id="parentLogout">تسجيل خروج</button></div><div style="overflow:auto"><table class="parent-table"><thead><tr><th>الطالب</th><th>الدرجة</th><th>من أول مرة</th><th>Hints</th><th>التاريخ</th></tr></thead><tbody>${rows}</tbody></table></div><div class="section-title">🎁 طلبات المكافآت</div>${(d.reward_claims||[]).length?`<div class="muted">${d.reward_claims.length} طلب/طلبات قيد السجل.</div>`:'<div class="empty">لا توجد طلبات مكافآت بعد.</div>'}</section>`);
  parentLogout.onclick=()=>{localStorage.removeItem('parent_session');state.parentSession=null;renderParentLogin('login')};
}

async function route(){const h=location.hash.replace('#','');if(h==='student')return studentRoute();if(h==='parents')return parentRoute();landing()}
window.addEventListener('hashchange',route);route();
