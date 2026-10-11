(() => {
  let active = null;
  const format = milliseconds => {
    const value = Number(milliseconds);
    const seconds = Math.floor((Number.isFinite(value) ? Math.max(0, value) : 0) / 1000);
    const pad = value => String(value).padStart(2, '0');
    const hours = Math.floor(seconds / 3600);
    return hours ? `${pad(hours)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` : `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  };

  function create(dependencies = {}) {
    active?.dispose();
    const now = dependencies.now || (() => Date.now());
    const schedule = dependencies.setInterval || globalThis.setInterval;
    const cancel = dependencies.clearInterval || globalThis.clearInterval;
    let identity = null, startedAt = null, target = null, interval = null, observer = null, disposed = false;
    const stop = () => {
      if (interval !== null) cancel(interval);
      interval = null;
      observer?.disconnect();
      observer = null;
      target = null;
    };
    const update = () => {
      if (!target?.isConnected) { stop(); return; }
      target.textContent = startedAt === null ? '--:--' : format(now() - startedAt);
    };
    const controller = {
      activate(key, start = now()) {
        if (disposed || key === identity) return;
        identity = key;
        const parsed = typeof start === 'string' ? Date.parse(start) : start;
        startedAt = typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
      },
      attach(element) {
        if (disposed) return;
        target = element;
        update();
        if (!target || interval !== null) return;
        interval = schedule(update, 1000);
        const root = globalThis.document?.getElementById('app');
        if (root && typeof MutationObserver === 'function') {
          observer = new MutationObserver(() => { if (!target?.isConnected) stop(); });
          observer.observe(root, {childList:true, subtree:true});
        }
      },
      stop,
      dispose() { stop(); disposed = true; if (active === controller) active = null; }
    };
    active = controller;
    return controller;
  }
  globalThis.FLHElapsedTimer = {format, create, dispose:() => active?.dispose()};
})();
