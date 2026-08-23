(() => {
  let queued=false;
  function friendlyBadgeReason(text,title=''){
    const t=(text||'').trim();
    if(!t.startsWith('quiz:')) return t;
    if(title.includes('من أول محاولة')) return 'أجبت إجابات صحيحة من أول محاولة في كويز الكسور (1).';
    if(title.includes('ما استسلمت')) return 'ثابرت واستخدمت التلميحات حتى أكملت كويز الكسور (1).';
    return 'إنجاز جميل في كويز الكسور (1).';
  }
  function polish(){
    document.querySelectorAll('body *').forEach(el=>{
      if(el.children.length || ['SCRIPT','STYLE','NOSCRIPT'].includes(el.tagName)) return;
      const old=el.textContent;
      if(!old) return;
      let v=old.replace(/Hints/g,'تلميحات').replace(/Hint\s*(\d+)\/4/g,'تلميح $1/4').replace(/Hint/g,'تلميح');
      if(v!==old) el.textContent=v;
    });
    document.querySelectorAll('.badge').forEach(b=>{
      const muted=b.querySelector('.muted');
      if(!muted) return;
      const title=b.querySelector('b')?.textContent||'';
      const next=friendlyBadgeReason(muted.textContent,title);
      if(next!==muted.textContent) muted.textContent=next;
    });
  }
  function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;polish();});}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',schedule); schedule();
})();
