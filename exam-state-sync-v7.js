(() => {
  const TOTAL = 10;
  const learnerToken = () => localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
  const hashToken = (s='') => {
    let h = 2166136261;
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
    return (h>>>0).toString(36);
  };
  const key = () => `exam_progress_v7_${hashToken(learnerToken())}`;
  const currentIndex = () => {
    const t=document.querySelector('.exam-status .topline b')?.textContent||'';
    const m=t.match(/السؤال\s+(\d+)\s+من/);
    return m?Number(m[1]):0;
  };
  document.addEventListener('click',e=>{
    const b=(e.target instanceof Element)?e.target.closest('#examAnswers .answer'):null;
    if(!b) return;
    try{
      const s=JSON.parse(localStorage.getItem(key())||'null');
      const idx=currentIndex();
      const n=Number(b.getAttribute('data-n'));
      if(!s?.active||!idx||!Number.isFinite(n)||!Array.isArray(s.answers)||s.answers.length!==TOTAL) return;
      s.current=idx;
      s.answers[idx-1]=n;
      s.updatedAt=Date.now();
      localStorage.setItem(key(),JSON.stringify(s));
    }catch{}
  },true);
})();
