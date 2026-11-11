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
      return `<figure class="flh-visual-asset" data-vquestion="${safe(q.id||q.question_id)}" data-vasset="${safe(a.asset_id)}"><figcaption dir="auto">${safe(a.label||'الرسم '+a.position)}</figcaption><button type="button" class="flh-visual-enlarge" aria-label="تكبير ${safe(a.label||'الرسم '+a.position)}" disabled><img ${a.url?`src="${safe(a.url)}"`:''} alt="${safe(a.alt_text)}" width="${Number(a.width)}" height="${Number(a.height)}" decoding="async"></button><p class="flh-visual-status" role="status" aria-live="polite">جارٍ تحميل الرسم…</p><button class="btn btn-soft flh-visual-retry" type="button" hidden>إعادة تحميل الرسم</button></figure>`;
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
      // Media URLs are private and short-lived; a late question may outlive its signed URL.
      // A single automatic renewal is safe/read-only. The manual retry remains available.
      let renewing=false,automaticRenewalUsed=false,renewalBlocked=false;
      const expiresSoon=()=>Number.isFinite(Date.parse(a.expires_at))&&Date.parse(a.expires_at)<=Date.now()+30000;
      // Never trust an old image load after renewal started or failed, even if
      // the original fetch completes while the signed-link request is pending.
      const currentImageReady=()=>!renewing&&!renewalBlocked&&!expiresSoon()
        &&img.complete&&img.naturalWidth>0&&img.currentSrc===a.url;
      async function renew(){
        if(renewing)return;
        renewing=true;renewalBlocked=true;states.set(key(q,a),false);enlarge.disabled=true;onChange();
        retry.disabled=true;status.textContent='جارٍ إعادة تحميل الرسم…';
        try{
          const data=await refresh(q.id||q.question_id);
          current();if(session!==originalSession||!figure.isConnected)return;
          const updated=data?.questions?.find(x=>x.question_id===(q.id||q.question_id))?.assets?.find(x=>x.asset_id===a.asset_id&&x.checksum_sha256===a.checksum_sha256);
          if(!updated?.url||!Number.isFinite(Date.parse(updated.expires_at))||Date.parse(updated.expires_at)<=Date.now()+30000)throw Error('UNAVAILABLE');
          Object.assign(a,updated);states.set(key(q,a),false);
          img.src=a.url;
          renewalBlocked=false;
        }catch{set(false);}finally{
          renewing=false;retry.disabled=false;
          if(currentImageReady())set(true);
        }
      }
      function failed(){
        if(renewing||renewalBlocked)return;
        if(!automaticRenewalUsed){automaticRenewalUsed=true;void renew();}
        else set(false);
      }
      img.addEventListener('load',()=>{if(currentImageReady())set(true);});
      img.addEventListener('error',failed);
      if(!a.url||expiresSoon()){automaticRenewalUsed=true;void renew();}
      else if(img.complete){if(currentImageReady())set(true);else failed();}
      retry.addEventListener('click',()=>{void renew();});
      enlarge.addEventListener('click',()=>{
        if(enlarge.disabled)return;
        const d=document.createElement('dialog');d.className='flh-visual-dialog';d.setAttribute('aria-label',a.label||'الرسم');
        d.innerHTML=`<button class="btn btn-soft" type="button">رجوع للسؤال</button><p>${safe(a.label||'الرسم')}</p><img src="${safe(img.src)}" alt="${safe(a.alt_text)}">`;
        // The inline image may already be wider than a small source raster.
        d.querySelector('img').style.minWidth=`${Math.ceil(img.getBoundingClientRect().width*1.25)}px`;
        const close=()=>{d.remove();if(enlarge.isConnected)enlarge.focus();};d.addEventListener('cancel',e=>{e.preventDefault();close();});d.querySelector('button').onclick=close;root.append(d);d.showModal();d.querySelector('button').focus();
      });
    }
    onChange();
  }
  globalThis.FLHAssessmentAssets={html,ready,mount};
})();
