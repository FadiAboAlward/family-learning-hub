(() => {
  const safe=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const states=new Map();let session='';
  const key=(q,a)=>(q.id||q.question_id)+':'+a.asset_id;
  function current(){const value=localStorage.getItem('learner_session')||sessionStorage.getItem('learner_session')||'';if(value!==session){states.clear();session=value;}}
  const visual=q=>q?.assessment_profile==='visual-foundation-bridge-v1';
  function html(q){
    current();if(!visual(q))return null;
    return(q.assets||[]).map(a=>{
      states.set(key(q,a),false);
      return `<figure class="flh-visual-asset" data-vquestion="${safe(q.id||q.question_id)}" data-vasset="${safe(a.asset_id)}"><figcaption>${safe(a.label||'الرسم '+a.position)}</figcaption><button type="button" class="flh-visual-enlarge" aria-label="تكبير ${safe(a.label||'الرسم '+a.position)}" disabled><img ${a.url?`src="${safe(a.url)}"`:''} alt="${safe(a.alt_text)}" width="${Number(a.width)}" height="${Number(a.height)}" decoding="async"></button><p class="flh-visual-status" role="status" aria-live="polite">جارٍ تحميل الرسم…</p><button class="btn btn-soft flh-visual-retry" type="button" hidden>إعادة تحميل الرسم</button></figure>`;
    }).join('');
  }
  function ready(q){current();return !visual(q)||(q.assets||[]).filter(a=>a.required).every(a=>states.get(key(q,a))===true);}
  function mount(root,{questions,refresh,onChange=()=>{}}){
    for(const figure of root.querySelectorAll('.flh-visual-asset:not([data-media-bound])')){
      figure.dataset.mediaBound='1';
      const q=questions.find(q=>(q.id||q.question_id)===figure.dataset.vquestion),a=q?.assets?.find(a=>a.asset_id===figure.dataset.vasset);
      if(!a)continue;
      const img=figure.querySelector('img'),enlarge=figure.querySelector('.flh-visual-enlarge'),status=figure.querySelector('.flh-visual-status'),retry=figure.querySelector('.flh-visual-retry');
      const originalSession=session;
      function set(ok){current();if(originalSession!==session||!figure.isConnected)return;states.set(key(q,a),ok);enlarge.disabled=!ok;status.textContent=ok?'':a.required?'تعذر تحميل الرسم الضروري. أعد المحاولة أو ارجع؛ لم تُسجّل إجابة.':'الرسم الاختياري غير متاح. يمكنك المتابعة.';retry.hidden=ok;onChange();}
      img.addEventListener('load',()=>set(img.naturalWidth>0));img.addEventListener('error',()=>set(false));
      if(!a.url)set(false);else if(img.complete)set(img.naturalWidth>0);
      retry.addEventListener('click',async()=>{
        retry.disabled=true;status.textContent='جارٍ إعادة تحميل الرسم…';
        try{
          const data=await refresh(q.id||q.question_id);
          current();if(session!==originalSession||!figure.isConnected)return;
          const updated=data?.questions?.find(x=>x.question_id===(q.id||q.question_id))?.assets?.find(x=>x.asset_id===a.asset_id&&x.checksum_sha256===a.checksum_sha256);
          if(!updated?.url)throw Error('UNAVAILABLE');
          Object.assign(a,updated);states.set(key(q,a),false);img.src=a.url;
        }catch{set(false);}finally{retry.disabled=false;}
      });
      enlarge.addEventListener('click',()=>{
        if(enlarge.disabled)return;
        const d=document.createElement('dialog');d.className='flh-visual-dialog';d.setAttribute('aria-label',a.label||'الرسم');
        d.innerHTML=`<button class="btn btn-soft" type="button">رجوع للسؤال</button><p>${safe(a.label||'الرسم')}</p><img src="${safe(img.src)}" alt="${safe(a.alt_text)}">`;
        const close=()=>{d.remove();if(enlarge.isConnected)enlarge.focus();};d.addEventListener('cancel',e=>{e.preventDefault();close();});d.querySelector('button').onclick=close;root.append(d);d.showModal();d.querySelector('button').focus();
      });
    }
    onChange();
  }
  globalThis.FLHAssessmentAssets={html,ready,mount};
})();
