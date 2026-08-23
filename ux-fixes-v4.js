(() => {
  const FAMILY_API_MARKER = '/functions/v1/family-api';
  const nativeFetch = window.fetch.bind(window);

  // Exam rule: a clearly failed exam (<60%) is saved, but does not earn XP/points or trigger celebration.
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

  function addSessionIdentity(){
    if(location.hash !== '#student' || !learnerToken()) return;
    const hero = document.querySelector('#app .hero');
    if(!hero || hero.querySelector('.session-identity')) return;
    const h1 = hero.querySelector('h1');
    if(!h1) return;
    let name = h1.textContent.replace('أهلًا','').replace('👋','').trim();
    if(!name || /منصة|دخول|وضع|نتيجة/.test(name)) return;
    const badge = document.createElement('div');
    badge.className = 'session-identity';
    badge.textContent = `🔐 مسجّل الدخول باسم: ${name}`;
    hero.appendChild(badge);
  }

  function fixLowScoreMessage(){
    const scoreEl = document.querySelector('.exam-score');
    const save = document.getElementById('examSaveState');
    if(!scoreEl || !save) return;
    const m = scoreEl.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if(!m) return;
    const pct = Number(m[2]) ? Number(m[1]) / Number(m[2]) * 100 : 0;
    if(pct >= 60) return;
    if(save.dataset.lowScorePolished) return;
    const success = save.querySelector('.success');
    if(!success) return;
    save.dataset.lowScorePolished = '1';
    save.innerHTML = '<div class="supportive-save">✅ انحفظت نتيجة الامتحان. هالمرة ما في نقاط أو احتفال؛ خلّينا نراجع الأخطاء وبعدها نجرب من جديد 💪</div>';
  }

  function polish(){
    addSessionIdentity();
    fixLowScoreMessage();
  }

  let queued=false;
  function schedule(){
    if(queued) return;
    queued=true;
    queueMicrotask(()=>{queued=false;polish();});
  }
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(schedule,30));
  document.addEventListener('DOMContentLoaded',schedule);
  schedule();
})();
