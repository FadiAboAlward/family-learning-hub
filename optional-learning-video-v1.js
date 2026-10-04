(() => {
  const reports = new Set(['not_reported', 'not_watched', 'watched_part', 'watched_full']);
  const labels = {not_reported:'لم أقدّم إفادة',not_watched:'لم أشاهد الفيديو',watched_part:'شاهدت جزءًا منه',watched_full:'شاهدته كاملًا'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let apiPromise, disposeCurrent = () => {};

  // Only readiness/errors are observed. Playback state and time are never read.
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

  function show({video, attemptId, call, renderShell, onStart, onExit, reportEnabled=true, startLabel='ابدأ التدريب الآن بدون انتظار'}) {
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
    let activeIndex = 0, alive = true, player, playerTimeout;

    renderShell(`<section class="panel flh-optional-video" id="flhOptionalVideo" aria-labelledby="flhVideoHeading">
      <h2 id="flhVideoHeading">فيديوهات تعليمية اختيارية</h2>
      <p>يمكنك مشاهدة درس واحد أو أكثر، أو بدء التدريب الآن. المشاهدة ليست شرطًا ولا تؤثر على نقاطك.</p>
      <div class="actions"><button class="btn btn-primary" id="flhVideoStart">${escape(startLabel)}</button></div>
      ${videos.length > 1 ? `<div class="flh-video-sequence" role="navigation" aria-label="دروس الفيديو">
        ${videos.map((item,index)=>`<button class="btn btn-soft flh-video-sequence-item" type="button" data-video-index="${index}" aria-current="${index===0?'true':'false'}">الدرس ${escape(item.position || index+1)}</button>`).join('')}
      </div>` : ''}
      <div id="flhVideoLesson"></div>
      <div class="actions"><button class="btn btn-soft" id="flhVideoExit">رجوع لمكتبتي</button></div>
    </section>`);

    const card = document.getElementById('flhOptionalVideo');
    const lesson = card?.querySelector('#flhVideoLesson');
    if (!card || !lesson) return false;

    function stopPlayer() {
      clearTimeout(playerTimeout);
      try { player?.destroy(); } catch {}
      player = null;
      card.querySelector('#flhVideoFrame')?.remove();
    }
    function cleanup() { if (!alive) return; alive = false; observer.disconnect(); stopPlayer(); }
    function available(item) {
      return item.availability === 'available' && typeof item.made_for_kids === 'boolean' && Date.parse(item.verification_expires_at) > Date.now();
    }
    function markActive() {
      card.querySelectorAll('.flh-video-sequence-item').forEach((button,index) => button.setAttribute('aria-current', index === activeIndex ? 'true' : 'false'));
    }
    function fallback() {
      if (!alive) return;
      stopPlayer();
      card.querySelector('#flhVideoFallback')?.removeAttribute('hidden');
      const unavailable = card.querySelector('#flhVideoUnavailable');
      if (unavailable) unavailable.hidden = true;
    }
    function activatePlayer(item) {
      if (!available(item)) return;
      const params = new URLSearchParams({autoplay:'0',rel:'0',controls:'1',playsinline:'1',enablejsapi:'1',origin:location.origin});
      const source = `https://www.youtube-nocookie.com/embed/${item.video_ref}?${params}`;
      const frame = card.querySelector('#flhVideoFrame');
      if (frame) frame.src = source;
      playerTimeout = setTimeout(fallback, 10000);
      loadPlayerApi().then(YT => {
        if (!alive || !card.querySelector('#flhVideoFrame')) return;
        const created = new YT.Player('flhVideoFrame', {events:{onReady:() => clearTimeout(playerTimeout),onError:fallback}});
        if (!alive || !card.querySelector('#flhVideoFrame')) { try { created.destroy(); } catch {} }
        else player = created;
      }).catch(fallback);
    }
    function renderActive() {
      stopPlayer();
      const index = activeIndex, state = states[index], item = state.video;
      const language = ['ar','tr','en'].includes(item.language) ? item.language : 'ar';
      const isAvailable = available(item);
      lesson.innerHTML = `<div class="flh-video-lesson-status">الدرس ${escape(item.position || index+1)} من ${videos.length}</div>
        <h3 dir="${language === 'ar' ? 'rtl' : 'ltr'}" lang="${language}">${escape(item.title || 'شرح للمهارة الحالية')}</h3>
        <p class="muted">مصدر الفيديو: YouTube</p>
        ${isAvailable ? `<div class="flh-video-player"><iframe id="flhVideoFrame" title="${escape('فيديو YouTube اختياري: ' + (item.title || 'شرح للمهارة الحالية'))}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ''}
        <p id="flhVideoFallback" role="status" ${isAvailable ? 'hidden' : ''}>هذا الفيديو غير متاح الآن. يمكنك اختيار درس آخر أو بدء التدريب مباشرة.</p>
        <button class="btn btn-soft" id="flhVideoUnavailable" ${isAvailable ? '' : 'hidden'}>الفيديو لا يعمل</button>
        ${reportEnabled ? `<fieldset class="flh-video-report"><legend>إفادتك عن مشاهدة هذا الدرس — اختيارية</legend>
          <p class="muted" id="flhVideoReportHelp">هذه إفادتك أنت في Family Learning Hub؛ لم نقِس مشاهدتك من YouTube. يمكنك تركها فارغة.</p>
          <label for="flhVideoReport">ماذا شاهدت؟ (اختياري)</label>
          <select id="flhVideoReport" aria-describedby="flhVideoReportHelp">${[...reports].map(value => `<option value="${value}" ${value === state.selfReport ? 'selected' : ''}>${labels[value]}</option>`).join('')}</select>
          <button class="btn btn-soft" id="flhVideoSave">حفظ إفادتي</button>
          <p id="flhVideoReportStatus" role="status">${state.selfReport === 'not_reported' ? 'لم تُقدّم إفادة عن المشاهدة.' : `إفادتك المحفوظة: ${labels[state.selfReport]}.`}</p>
        </fieldset>` : ''}`;
      markActive();
      lesson.querySelector('#flhVideoUnavailable')?.addEventListener('click', fallback);
      lesson.querySelector('#flhVideoFrame')?.addEventListener('error', fallback);
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
      activatePlayer(item);
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
