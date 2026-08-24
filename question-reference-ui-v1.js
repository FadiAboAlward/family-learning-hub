(() => {
  const SUPABASE_URL='https://gkpoylfozvuwuwqeoduc.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
  const REF_API=`${SUPABASE_URL}/functions/v1/question-reference-api`;
  const previousFetch=window.fetch.bind(window);
  const stateRef={attemptId:'',mode:'',questionIds:[],reviewIds:[],codes:{}};
  const learnerToken=()=>localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';

  function reqInfo(args){
    const url=typeof args[0]==='string'?args[0]:args[0]?.url||'';
    let body={};
    try{const init=args[1]||{};if(typeof init.body==='string')body=JSON.parse(init.body)}catch{}
    return{url,body};
  }

  async function refreshCodes(){
    if(!stateRef.attemptId||!learnerToken())return;
    try{
      const r=await previousFetch(REF_API,{method:'POST',headers:{'content-type':'application/json','apikey':PUBLISHABLE_KEY,'authorization':`Bearer ${learnerToken()}`},body:JSON.stringify({action:'codes',attempt_id:stateRef.attemptId})});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.codes){stateRef.codes={...stateRef.codes,...d.codes};syncUi()}
    }catch{}
  }

  window.fetch=async(...args)=>{
    const info=reqInfo(args);
    const response=await previousFetch(...args);
    if(!response.ok)return response;
    const learning=info.url.includes('/functions/v1/learning-api');
    const exam=info.url.includes('/functions/v1/exam-v2-api');
    if(!learning&&!exam)return response;
    try{
      const d=await response.clone().json();
      if(learning&&info.body.action==='start_quiz'){
        stateRef.attemptId=d.attempt_id||'';stateRef.mode='learning';stateRef.questionIds=(d.queue||[]).map(x=>x.question_id);stateRef.reviewIds=[];stateRef.codes={};refreshCodes();
      }else if(exam&&info.body.action==='start_exam'){
        stateRef.attemptId=d.attempt_id||'';stateRef.mode='exam';stateRef.questionIds=(d.questions||[]).map(x=>x.question_id);stateRef.reviewIds=[];stateRef.codes={};refreshCodes();
      }else if(learning&&info.body.action==='answer'&&d.remediation_added?.question_id){
        if(!stateRef.questionIds.includes(d.remediation_added.question_id))stateRef.questionIds.push(d.remediation_added.question_id);refreshCodes();
      }else if(learning&&info.body.action==='finish_quiz'){
        stateRef.reviewIds=(d.review||[]).map(x=>x.question_id);syncUi();
      }else if(exam&&info.body.action==='submit_exam'){
        stateRef.reviewIds=(d.review||[]).map(x=>x.question_id);syncUi();
      }
    }catch{}
    return response;
  };

  function copyText(text,btn){
    const done=()=>{const old=btn.textContent;btn.textContent=`✓ تم نسخ ${text}`;setTimeout(()=>{if(btn.isConnected)btn.textContent=old},1200)};
    if(navigator.clipboard?.writeText){navigator.clipboard.writeText(text).then(done).catch(()=>fallback(text,done));}
    else fallback(text,done);
  }
  function fallback(text,done){const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();try{document.execCommand('copy');done()}catch{}t.remove()}
  function chip(code){const b=document.createElement('button');b.type='button';b.className='question-ref-chip';b.textContent=`🔖 ${code}`;b.title='اضغط لنسخ رمز السؤال';b.setAttribute('aria-label',`نسخ رمز السؤال ${code}`);b.addEventListener('click',()=>copyText(code,b));return b}

  function currentIndex(panel){
    const txt=panel.querySelector('.exam-status .topline b')?.textContent||panel.querySelector('.topline b')?.textContent||'';
    const m=txt.match(/السؤال\s+(\d+)/);return m?Math.max(0,Number(m[1])-1):-1;
  }
  function syncCurrent(){
    const q=document.querySelector('#app .question');if(!q)return;const panel=q.closest('.panel');if(!panel)return;
    const idx=currentIndex(panel);if(idx<0)return;const qid=stateRef.questionIds[idx],code=stateRef.codes[qid];if(!code)return;
    const existing=panel.querySelector('.question-ref-chip');if(existing){if(existing.textContent?.includes(code))return;existing.remove()}
    const anchor=panel.querySelector('.exam-status')||panel.querySelector('.topline');if(anchor)anchor.insertAdjacentElement('afterend',chip(code));else q.insertAdjacentElement('beforebegin',chip(code));
  }
  function syncReview(){
    const ids=stateRef.reviewIds.length?stateRef.reviewIds:stateRef.questionIds;
    document.querySelectorAll('#app .exam-review').forEach((d,i)=>{
      const code=stateRef.codes[ids[i]];if(!code||d.querySelector('.question-ref-review'))return;
      const b=chip(code);b.classList.add('question-ref-review');d.querySelector('summary')?.insertAdjacentElement('afterend',b);
    });
  }
  function syncUi(){syncCurrent();syncReview()}
  const observer=new MutationObserver(()=>queueMicrotask(syncUi));observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',syncUi);window.addEventListener('hashchange',()=>{if(location.hash!=='#student'){stateRef.attemptId='';stateRef.questionIds=[];stateRef.reviewIds=[];stateRef.codes={}}});
  window.FLH=window.FLH||{};window.FLH.questionReferenceState=stateRef;
})();
