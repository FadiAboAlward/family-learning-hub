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

  function show({video, attemptId, call, renderShell, onStart, onExit}) {
    dispose();
    if (!video || video.provider !== 'youtube' || !/^[A-Za-z0-9_-]{11}$/.test(video.video_ref || '') || !video.id) return false;
    const language = ['ar','tr','en'].includes(video.language) ? video.language : 'ar';
    let selfReport = reports.has(video.self_report) ? video.self_report : 'not_reported';
    let revision = Number.isSafeInteger(video.report_revision) ? video.report_revision : 0;
    const available = video.availability === 'available' && typeof video.made_for_kids === 'boolean' && Date.parse(video.verification_expires_at) > Date.now();
    const params = new URLSearchParams({autoplay:'0',rel:'0',controls:'1',playsinline:'1',enablejsapi:'1',origin:location.origin});
    const source = `https://www.youtube-nocookie.com/embed/${video.video_ref}?${params}`;
    renderShell(`<section class="panel flh-optional-video" id="flhOptionalVideo" aria-labelledby="flhVideoHeading">
      <h2 id="flhVideoHeading">فيديو تعليمي اختياري</h2>
      <p>يمكنك مشاهدة الفيديو أو جزء منه، أو بدء التدريب الآن. المشاهدة ليست شرطًا ولا تؤثر على نقاطك.</p>
      <div class="actions"><button class="btn btn-primary" id="flhVideoStart">ابدأ التدريب الآن بدون انتظار</button></div>
      <h3 dir="${language === 'ar' ? 'rtl' : 'ltr'}" lang="${language}">${escape(video.title || 'شرح للمهارة الحالية')}</h3>
      <p class="muted">مصدر الفيديو: YouTube</p>
      ${available ? `<div class="flh-video-player"><iframe id="flhVideoFrame" title="${escape('فيديو YouTube اختياري: ' + (video.title || 'شرح للمهارة الحالية'))}" src="${escape(source)}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>` : ''}
      <p id="flhVideoFallback" role="status" ${available ? 'hidden' : ''}>الفيديو غير متاح الآن. يمكنك بدء التدريب مباشرة.</p>
      <button class="btn btn-soft" id="flhVideoUnavailable" ${available ? '' : 'hidden'}>الفيديو لا يعمل</button>
      <fieldset class="flh-video-report"><legend>إفادتك عن المشاهدة — اختيارية</legend>
        <p class="muted" id="flhVideoReportHelp">هذه إفادتك أنت في Family Learning Hub؛ لم نقِس مشاهدتك من YouTube. يمكنك تركها فارغة وبدء التدريب.</p>
        <label for="flhVideoReport">ماذا شاهدت؟ (اختياري)</label>
        <select id="flhVideoReport" aria-describedby="flhVideoReportHelp">${[...reports].map(value => `<option value="${value}" ${value === selfReport ? 'selected' : ''}>${labels[value]}</option>`).join('')}</select>
        <button class="btn btn-soft" id="flhVideoSave">حفظ إفادتي</button>
        <p id="flhVideoReportStatus" role="status">${selfReport === 'not_reported' ? 'لم تُقدّم إفادة عن المشاهدة.' : `إفادتك المحفوظة: ${labels[selfReport]}.`}</p>
      </fieldset>
      <div class="actions"><button class="btn btn-soft" id="flhVideoExit">رجوع لمكتبتي</button></div>
    </section>`);

    const card = document.getElementById('flhOptionalVideo');
    if (!card) return false;
    const select = card.querySelector('#flhVideoReport');
    const save = card.querySelector('#flhVideoSave');
    const status = card.querySelector('#flhVideoReportStatus');
    let alive = true, player, playerTimeout, pendingRequest, saving = false;
    function stopPlayer() {
      clearTimeout(playerTimeout);
      try { player?.destroy(); } catch {}
      player = null;
      card.querySelector('#flhVideoFrame')?.remove();
    }
    function fallback() {
      if (!alive) return;
      stopPlayer();
      card.querySelector('#flhVideoFallback').hidden = false;
      card.querySelector('#flhVideoUnavailable').hidden = true;
    }
    const observer = new MutationObserver(() => { if (!card.isConnected) cleanup(); });
    function cleanup() { if (!alive) return; alive = false; observer.disconnect(); stopPlayer(); }
    disposeCurrent = cleanup;
    observer.observe(document.getElementById('app') || document.body, {childList:true,subtree:true});
    card.querySelector('#flhVideoStart').addEventListener('click', () => { cleanup(); onStart(); });
    card.querySelector('#flhVideoExit').addEventListener('click', () => { cleanup(); onExit(); });
    card.querySelector('#flhVideoUnavailable').addEventListener('click', fallback);
    card.querySelector('#flhVideoFrame')?.addEventListener('error', fallback);
    select.addEventListener('change', () => { pendingRequest = null; });
    save.addEventListener('click', async () => {
      if (saving || !alive || !reports.has(select.value)) return;
      saving = true; save.disabled = true; select.disabled = true;
      pendingRequest ||= {attempt_id:attemptId,video_id:video.id,self_report:select.value,expected_revision:revision,request_id:crypto.randomUUID()};
      status.textContent = 'جارٍ حفظ إفادتك. يمكنك بدء التدريب الآن.';
      try {
        const result = await call('save_video_report', pendingRequest);
        if (!alive) return;
        if (!reports.has(result.self_report) || !Number.isSafeInteger(result.report_revision)) throw new Error('REPORT_UNAVAILABLE');
        selfReport = result.self_report; revision = result.report_revision; select.value = selfReport; pendingRequest = null;
        status.textContent = `إفادتك المحفوظة: ${labels[selfReport]}.`;
      } catch (error) {
        if (!alive) return;
        const current = error?.data;
        if (error.message === 'REPORT_CONFLICT' && reports.has(current?.self_report) && Number.isSafeInteger(current?.report_revision)) {
          revision = current.report_revision; pendingRequest = null;
          status.textContent = 'تغيّرت إفادتك في جلسة أخرى. يمكنك حفظ اختيارك مجددًا أو بدء التدريب الآن.';
        } else status.textContent = 'تعذر التأكد من حفظ إفادتك. أعد المحاولة أو ابدأ التدريب الآن.';
      } finally { saving = false; if (alive) { save.disabled = false; select.disabled = false; } }
    });

    if (available) {
      playerTimeout = setTimeout(fallback, 10000);
      loadPlayerApi().then(YT => {
        if (!alive || !card.querySelector('#flhVideoFrame')) return;
        player = new YT.Player('flhVideoFrame', {events:{onReady:() => clearTimeout(playerTimeout),onError:fallback}});
      }).catch(fallback);
    }
    return true;
  }
  globalThis.FLHOptionalVideo = {show,dispose};
})();
