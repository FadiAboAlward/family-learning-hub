(() => {
  const FAMILY_API_MARKER = '/functions/v1/family-api';
  const nativeFetch = window.fetch.bind(window);

  // Compatibility guard for any retired client that still tries the legacy exam completion action.
  window.fetch = async (input, init={}) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    if(url.includes(FAMILY_API_MARKER) && String(init?.method || 'GET').toUpperCase() === 'POST'){
      try{
        const body = JSON.parse(init.body || '{}');
        if(body.action === 'complete_quiz' && body.delivery_mode === 'exam' && Number(body.score || 0) < 60){
          return new Response(JSON.stringify({
            already_awarded:true,
            award:{xp:0,reward_points:0,badges:[]},
            no_award_reason:'exam_score_below_60'
          }), {status:200,headers:{'Content-Type':'application/json'}});
        }
      }catch{}
    }
    return nativeFetch(input, init);
  };

  function learnerToken(){
    return localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  }

  function learnerName(){
    try{
      if(typeof state !== 'undefined' && state?.learnerProfile?.learner?.display_name){
        return String(state.learnerProfile.learner.display_name).trim();
      }
    }catch{}
    const h1=document.querySelector('#app .hero h1');
    const text=(h1?.textContent||'').trim();
    // Fallback is allowed only on the actual learner home greeting, never on quiz/result screen titles.
    if(!text.startsWith('أهلًا')) return '';
    return text.replace('أهلًا','').replace('👋','').trim();
  }

  function addSessionIdentity(){
    if(location.hash !== '#student' || !learnerToken()) return;
    const hero = document.querySelector('#app .hero');
    if(!hero) return;
    const name=learnerName();
    if(!name) return;
    let badge=hero.querySelector('.session-identity');
    if(!badge){
      badge=document.createElement('div');
      badge.className='session-identity';
      hero.appendChild(badge);
    }
    const wanted=`🔐 مسجّل الدخول باسم: ${name}`;
    if(badge.textContent!==wanted) badge.textContent=wanted;
  }

  function fixLowScoreMessage(){
    const scoreEl = document.querySelector('.exam-score');
    const save = document.getElementById('examSaveState');
    if(!scoreEl || !save) return;
    const m = scoreEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if(!m) return;
    const pct = Number(m[2]) ? Number(m[1]) / Number(m[2]) * 100 : 0;
    if(pct >= 60 || save.dataset.lowScorePolished) return;
    const success = save.querySelector('.success');
    if(!success) return;
    save.dataset.lowScorePolished = '1';
    save.innerHTML = '<div class="supportive-save">✅ انحفظت نتيجة الامتحان. هالمرة ما في نقاط أو احتفال؛ خلّينا نراجع الأخطاء وبعدها نجرب من جديد 💪</div>';
  }

  function polish(){ addSessionIdentity(); fixLowScoreMessage(); }
  let queued=false;
  function schedule(){ if(queued) return; queued=true; queueMicrotask(()=>{queued=false;polish();}); }
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(schedule,30));
  document.addEventListener('DOMContentLoaded',schedule);
  schedule();
})();
