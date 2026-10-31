(() => {
  const reports = new Set(['not_reported', 'not_watched', 'watched_part', 'watched_full']);
  const labels = {not_reported:'لم أقدّم إفادة',not_watched:'لم أشاهد الفيديو',watched_part:'شاهدت جزءًا منه',watched_full:'شاهدته كاملًا'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let apiPromise, disposeCurrent = () => {};

  // Playback state/time are used only for server-eligible, explicitly opted-in resume.
  function loadPlayerApi() {
    if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const previous = globalThis.onYouTubeIframeAPIReady;
      const timeout = setTimeout(() => reject(new Error('VIDEO_UNAVAILABLE')), 8000);
      globalThis.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        try { previous?.(); } catch {}
        if (globalThis.YT?.Player) resolve(globalThis.YT);
        else reject(new Error('VIDEO_UNAVAILABLE'));
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.onerror = () => { clearTimeout(timeout); reject(new Error('VIDEO_UNAVAILABLE')); };
      document.head.append(script);
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }

  function dispose() { disposeCurrent(); disposeCurrent = () => {}; }

  function learningOutcomes(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) return [];
    const outcomes = value.map(item => typeof item === 'string' ? item.trim() : '');
    if (outcomes.some(item => !item || [...item].length > 160 || /<\/?[A-Za-z][^>]*>|<!--|<!DOCTYPE|&(?:#(?:x[\da-f]+|\d+)|[a-z][\da-z]*);/iu.test(item)) || new Set(outcomes).size !== outcomes.length) return [];
    return outcomes;
  }

  function show({video, attemptId, call, progressCall, isSessionCurrent=()=>true, renderShell, onStart, onExit, onDispose=()=>{}, reportEnabled=true, startLabel='ابدأ التدريب الآن بدون انتظار', exitLabel='رجوع لمكتبتي', description='يمكنك مشاهدة درس واحد أو أكثر، أو بدء التدريب الآن. المشاهدة ليست شرطًا ولا تؤثر على نقاطك.'}) {
    dispose();
    const raw = Array.isArray(video?.videos) && video.videos.length ? video.videos : [video];
    const videos = raw
      .filter(item => item && item.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(item.video_ref || '') && item.id)
      .sort((a,b) => Number(a.position || 1) - Number(b.position || 1));
    if (!videos.length) return false;

    const states = videos.map(item => ({
      video:item,
      selfReport:reports.has(item.self_report) ? item.self_report : 'not_reported',
      revision:Number.isSafeInteger(item.report_revision) ? item.report_revision : 0,
      pendingRequest:null,
      saving:false,
    }));
    let activeIndex = 0, alive = true, player, playerTimeout, renderGeneration = 0, resume;

    renderShell(`<section class="panel flh-optional-video" id="flhOptionalVideo" aria-labelledby="flhVideoHeading">
      <h2 id="flhVideoHeading">فيديوهات تعليمية اختيارية</h2>
      <p>${escape(description)}</p>
      <div class="actions"><button class="btn btn-primary" id="flhVideoStart">${escape(startLabel)}</button></div>
      ${videos.length > 1 ? `<div class="flh-video-sequence" role="navigation" aria-label="دروس الفيديو">
        ${videos.map((item,index)=>`<button class="btn btn-soft flh-video-sequence-item" type="button" data-video-index="${index}" aria-current="${index===0?'true':'false'}">الدرس ${escape(item.position || index+1)}</button>`).join('')}
      </div>` : ''}
      <div id="flhVideoLesson"></div>
      <div class="actions"><button class="btn btn-soft" id="flhVideoExit">${escape(exitLabel)}</button></div>
    </section>`);

    const card = document.getElementById('flhOptionalVideo');
    const lesson = card?.querySelector('#flhVideoLesson');
    if (!card || !lesson) return false;

    function stopPlayer() {
      resume?.dispose(); resume = null;
      renderGeneration += 1;
      clearTimeout(playerTimeout);
      playerTimeout = null;
      try { player?.destroy(); } catch {}
      player = null;
      card.querySelector('#flhVideoFrame')?.remove();
    }
    function cleanup() { if (!alive) return; alive = false; observer.disconnect(); stopPlayer(); onDispose(); }
    function available(item) {
      return item.availability === 'available' && /^[A-Za-z0-9_-]{11}$/.test(item.video_ref || '');
    }
    function markActive() {
      card.querySelectorAll('.flh-video-sequence-item').forEach((button,index) => button.setAttribute('aria-current', index === activeIndex ? 'true' : 'false'));
    }
    function isCurrentRender(generation, index, frame) {
      return alive && generation === renderGeneration && index === activeIndex && frame?.isConnected && card.querySelector('#flhVideoFrame') === frame;
    }
    function fallback(generation, index) {
      if (!alive || generation !== renderGeneration || index !== activeIndex) return;
      stopPlayer();
      card.querySelector('#flhVideoFallback')?.removeAttribute('hidden');
      const unavailable = card.querySelector('#flhVideoUnavailable');
      if (unavailable) unavailable.hidden = true;
    }
    function createResume(state,index,generation) {
      const area=lesson.querySelector('#flhVideoResume'), item=state.video;
      const current=()=>alive&&isSessionCurrent()&&generation===renderGeneration&&index===activeIndex;
      const fresh=()=>state.progress?.eligible===true&&Date.parse(state.progress.eligible_until)>Date.now();
      let enabled=state.consent===true&&fresh(), started=false, ended=false, timer, disposed=false, pending=null, busy=null;
      const message=text=>{if(current()&&area?.isConnected){const status=area.querySelector('[data-progress-status]');if(status)status.textContent=text;}};
      const canTrack=()=>!disposed&&enabled&&fresh()&&isSessionCurrent();
      function controls(){
        if(!current()||!area)return;
        if(!fresh()) {area.innerHTML='<p class="muted" data-progress-status role="status">المشاهدة متاحة دون حفظ موضع التشغيل لهذا الفيديو.</p>';return;}
        const marker=state.progress,seconds=Number(marker.position_seconds)||0;
        area.innerHTML=`<p class="muted">حفظ الموضع اختياري لمدة ٢٩ يومًا، ويعمل عبر أجهزتك. الموضع تقريبي ولا يثبت المشاهدة أو الإتقان. <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">شروط YouTube</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">خصوصية Google</a></p>
          <p data-progress-status role="status">${enabled?'حفظ الموضع مفعّل لهذا العرض.':marker.ended?'وصل التشغيل سابقًا إلى النهاية. يمكنك البدء من جديد.':marker.has_progress?`آخر موضع محفوظ: ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'يمكنك المشاهدة دون حفظ، أو تفعيل الحفظ.'}</p>
          <div class="actions">${!enabled?`<button class="btn btn-soft" data-progress-enable>${marker.has_progress&&!marker.ended?'متابعة من الدقيقة السابقة':'تفعيل حفظ الموضع'}</button>`:''}
          ${marker.has_progress?'<button class="btn btn-soft" data-progress-restart>المشاهدة من البداية</button><button class="btn btn-soft" data-progress-clear>حذف الموضع وإيقاف الحفظ</button>':''}
          <button class="btn btn-soft" data-progress-reload>إعادة تحميل الموضع المحفوظ</button></div>`;
        area.querySelector('[data-progress-enable]')?.addEventListener('click',()=>{state.consent=true;state.seek=true;renderActive();});
        area.querySelector('[data-progress-restart]')?.addEventListener('click',()=>clear(true));
        area.querySelector('[data-progress-clear]')?.addEventListener('click',()=>clear(false));
        area.querySelector('[data-progress-reload]')?.addEventListener('click',()=>{enabled=false;state.consent=false;state.progress=null;renderActive();});
      }
      async function write(){
        if(busy)return busy;
        if(!pending||!isSessionCurrent())return false;
        const request=pending;
        busy=(async()=>{
          try{
            const result=await progressCall(request.clear?'clear_video_progress':'save_video_progress',request.payload);
            if(!result?.eligible||!Number.isSafeInteger(result.revision))throw new Error('VIDEO_PROGRESS_INELIGIBLE');
            state.progress=result;pending=null;
            controls();message('تم حفظ الموضع التقريبي.');return true;
          }catch(error){
            if(['VIDEO_PROGRESS_CONFLICT','VIDEO_PROGRESS_REQUEST_CONFLICT','VIDEO_PROGRESS_INELIGIBLE','VIDEO_NOT_AVAILABLE'].includes(error.message)){
              enabled=false;state.consent=false;pending=null;clearInterval(timer);
              message('تغيّر الحفظ أو إتاحة الفيديو. أعد تحميل الموضع قبل تفعيل الحفظ.');
            }else message('تعذر التأكد من الحفظ. سنعيد المحاولة؛ يمكنك متابعة دراستك.');
            return false;
          }finally{busy=null;}
        })();
        return busy;
      }
      function sample(){
        if(!canTrack()||!started||!player)return;
        if(!pending){
          let seconds;try{seconds=Math.round(player.getCurrentTime());}catch{return;}
          if(!Number.isFinite(seconds)||seconds<0||seconds>86400)return;
          pending={payload:{video_id:item.id,position_seconds:seconds,ended,expected_revision:state.progress.revision,request_id:crypto.randomUUID()}};
        }
        void write();
      }
      async function clear(restart){
        enabled=false;clearInterval(timer);
        if(busy)await busy;
        if(pending&&!(await write()))return;
        if(!current())return;
        pending={clear:true,payload:{video_id:item.id,expected_revision:state.progress.revision,request_id:crypto.randomUUID()}};
        if(await write()){state.consent=restart;state.seek=restart;if(current())renderActive();}
      }
      function leaving(){sample();}
      function visibility(){if(document.visibilityState==='hidden')sample();}
      controls();
      if(progressCall&&!state.progress&&item.made_for_kids===false&&Date.parse(item.verification_expires_at)>Date.now()){
        progressCall('get_video_progress',{video_id:item.id}).then(result=>{if(current()){state.progress=result;controls();}}).catch(()=>message('تعذر تحميل الموضع. المشاهدة متاحة دون حفظ.'));
      }
      window.addEventListener('pagehide',leaving);document.addEventListener('visibilitychange',visibility);
      return {
        get enabled(){return canTrack();},
        ready(target){
          if(!canTrack())return;
          if(state.seek){state.seek=false;try{target.seekTo(state.progress.ended?0:state.progress.position_seconds,true);}catch{}}
          timer=setInterval(()=>{if(!fresh()){enabled=false;state.consent=false;clearInterval(timer);controls();}else sample();},12000);
        },
        changed(event){if(!canTrack())return;if(event.data===1){started=true;ended=false;}if(event.data===0||event.data===2){ended=event.data===0;sample();}},
        dispose(){sample();disposed=true;clearInterval(timer);window.removeEventListener('pagehide',leaving);document.removeEventListener('visibilitychange',visibility);},
      };
    }
    function activatePlayer(item, index, generation) {
      if (!available(item)) return;
      const params = new URLSearchParams({autoplay:'0',rel:'0',controls:'1',playsinline:'1',enablejsapi:'1',origin:location.origin});
      const source = `https://www.youtube-nocookie.com/embed/${item.video_ref}?${params}`;
      const frame = card.querySelector('#flhVideoFrame');
      if (!frame) return;
      frame.src = source;
      playerTimeout = setTimeout(() => fallback(generation, index), 10000);
      loadPlayerApi().then(YT => {
        if (!isCurrentRender(generation, index, frame)) return;
        const created = new YT.Player(frame, {events:{
          onReady:event => { if (isCurrentRender(generation, index, frame)) {clearTimeout(playerTimeout);resume?.ready(event.target);} },
          onError:() => fallback(generation, index),
          ...(resume?.enabled?{onStateChange:event=>{if(isCurrentRender(generation,index,frame))resume?.changed(event);}}:{}),
        }});
        if (!isCurrentRender(generation, index, frame)) { try { created.destroy(); } catch {} }
        else player = created;
      }).catch(() => fallback(generation, index));
    }
    function renderActive() {
      stopPlayer();
      const generation = renderGeneration;
      const index = activeIndex, state = states[index], item = state.video;
      const language = ['ar','tr','en'].includes(item.language) ? item.language : 'ar';
      const isAvailable = available(item);
      const outcomes = learningOutcomes(item.learning_outcomes);
      const outcomeText = value => globalThis.FLHMathDirection?.isolateMathHtml?.(escape(value)) ?? escape(value);
      lesson.innerHTML = `<div class="flh-video-lesson-status">الدرس ${escape(item.position || index+1)} من ${videos.length}</div>
        <h3 dir="${language === 'ar' ? 'rtl' : 'ltr'}" lang="${language}">${escape(item.title || 'شرح للمهارة الحالية')}</h3>
        <p class="muted">مصدر الفيديو: YouTube</p>
        ${isAvailable && outcomes.length ? `<section class="flh-video-outcomes" aria-labelledby="flhVideoOutcomesHeading"><h4 id="flhVideoOutcomesHeading">ماذا ستتعلم؟</h4><ul lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">${outcomes.map(outcome => `<li>${outcomeText(outcome)}</li>`).join('')}</ul></section>` : ''}
        ${isAvailable ? `<div class="flh-video-player"><iframe id="flhVideoFrame" title="${escape('فيديو YouTube اختياري: ' + (item.title || 'شرح للمهارة الحالية'))}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ''}
        <p id="flhVideoFallback" role="status" ${isAvailable ? 'hidden' : ''}>هذا الفيديو غير متاح الآن. يمكنك اختيار درس آخر أو بدء التدريب مباشرة.</p>
        <button class="btn btn-soft" id="flhVideoUnavailable" ${isAvailable ? '' : 'hidden'}>الفيديو لا يعمل</button>
        ${isAvailable&&progressCall?'<section id="flhVideoResume" aria-label="استئناف الفيديو"></section>':''}
        ${reportEnabled ? `<fieldset class="flh-video-report"><legend>إفادتك عن مشاهدة هذا الدرس — اختيارية</legend>
          <p class="muted" id="flhVideoReportHelp">هذه إفادتك أنت في Family Learning Hub؛ لم نقِس مشاهدتك من YouTube. يمكنك تركها فارغة.</p>
          <label for="flhVideoReport">ماذا شاهدت؟ (اختياري)</label>
          <select id="flhVideoReport" aria-describedby="flhVideoReportHelp">${[...reports].map(value => `<option value="${value}" ${value === state.selfReport ? 'selected' : ''}>${labels[value]}</option>`).join('')}</select>
          <button class="btn btn-soft" id="flhVideoSave">حفظ إفادتي</button>
          <p id="flhVideoReportStatus" role="status">${state.selfReport === 'not_reported' ? 'لم تُقدّم إفادة عن المشاهدة.' : `إفادتك المحفوظة: ${labels[state.selfReport]}.`}</p>
        </fieldset>` : ''}`;
      markActive();
      lesson.querySelector('#flhVideoUnavailable')?.addEventListener('click', () => fallback(generation, index));
      lesson.querySelector('#flhVideoFrame')?.addEventListener('error', () => fallback(generation, index));
      if (reportEnabled) {
        const select = lesson.querySelector('#flhVideoReport');
        const save = lesson.querySelector('#flhVideoSave');
        const status = lesson.querySelector('#flhVideoReportStatus');
        select?.addEventListener('change', () => { state.pendingRequest = null; });
        save?.addEventListener('click', async () => {
          if (state.saving || !alive || !select || !save || !status || !reports.has(select.value)) return;
          state.saving = true; save.disabled = true; select.disabled = true;
          state.pendingRequest ||= {attempt_id:attemptId,video_id:item.id,self_report:select.value,expected_revision:state.revision,request_id:crypto.randomUUID()};
          status.textContent = 'جارٍ حفظ إفادتك. يمكنك بدء التدريب الآن.';
          try {
            const result = await call('save_video_report', state.pendingRequest);
            if (!alive) return;
            if (!reports.has(result.self_report) || !Number.isSafeInteger(result.report_revision)) throw new Error('REPORT_UNAVAILABLE');
            state.selfReport = result.self_report; state.revision = result.report_revision; state.pendingRequest = null;
            if (activeIndex === index && status.isConnected) {
              select.value = state.selfReport;
              status.textContent = `إفادتك المحفوظة: ${labels[state.selfReport]}.`;
            }
          } catch (error) {
            if (!alive) return;
            const current = error?.data;
            if (error.message === 'REPORT_CONFLICT' && reports.has(current?.self_report) && Number.isSafeInteger(current?.report_revision)) {
              state.revision = current.report_revision; state.pendingRequest = null;
              if (activeIndex === index && status.isConnected) status.textContent = 'تغيّرت إفادتك في جلسة أخرى. يمكنك حفظ اختيارك مجددًا أو بدء التدريب الآن.';
            } else if (activeIndex === index && status.isConnected) status.textContent = 'تعذر التأكد من حفظ إفادتك. أعد المحاولة أو ابدأ التدريب الآن.';
          } finally {
            state.saving = false;
            if (activeIndex === index && save.isConnected) { save.disabled = false; select.disabled = false; }
          }
        });
      }
      resume=createResume(state,index,generation);
      activatePlayer(item, index, generation);
    }

    const observer = new MutationObserver(() => { if (!card.isConnected) cleanup(); });
    disposeCurrent = cleanup;
    observer.observe(document.getElementById('app') || document.body, {childList:true,subtree:true});
    card.querySelector('#flhVideoStart').addEventListener('click', () => { cleanup(); onStart(); });
    card.querySelector('#flhVideoExit').addEventListener('click', () => { cleanup(); onExit(); });
    card.querySelectorAll('.flh-video-sequence-item').forEach(button => button.addEventListener('click', () => {
      const next = Number(button.getAttribute('data-video-index'));
      if (!Number.isInteger(next) || next < 0 || next >= videos.length || next === activeIndex) return;
      activeIndex = next;
      renderActive();
    }));
    renderActive();
    return true;
  }
  globalThis.FLHOptionalVideo = {show,dispose};
})();
