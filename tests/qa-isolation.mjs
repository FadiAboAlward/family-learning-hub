import {
  PRODUCTION_HOSTS, PRODUCTION_PROJECT_REF, assertQaIsolationAttestation,
  isProductionQaHost, requireIsolatedQaBackend, requireQaAppUrl, requireQaPublishableKey,
} from '../supabase/functions/_shared/qa-backend-isolation.mjs';

export { PRODUCTION_HOSTS, PRODUCTION_PROJECT_REF };

export function readQaTestingConfig(env = process.env) {
  const backend = requireIsolatedQaBackend({ mode: env.FLH_QA_ISOLATION_MODE, backendUrl: env.FLH_QA_BACKEND_URL, projectRef: env.FLH_QA_PROJECT_REF });
  return Object.freeze({ ...backend, publishableKey: requireQaPublishableKey(env.FLH_QA_PUBLISHABLE_KEY, backend), appUrl: requireQaAppUrl(env.APP_URL || 'http://127.0.0.1:4173/') });
}

export function readMockQaConfig(appUrl, env = process.env) {
  if (env.FLH_QA_ISOLATION_MODE !== 'mock-local') throw new Error('QA_MOCK_ISOLATION_MODE_REQUIRED');
  return Object.freeze({ mode: 'mock-local', backendUrl: 'http://qa-backend.invalid', publishableKey: 'sb_publishable_qa_synthetic', appUrl: requireQaAppUrl(appUrl) });
}

export function qaBrowserLaunchOptions() {
  return { headless: true, args: [`--host-resolver-rules=${PRODUCTION_HOSTS.map(host => `MAP ${host} 127.0.0.1`).join(', ')}`] };
}

export async function fetchQaBackend(config, functionName, options = {}, fetchImpl = globalThis.fetch) {
  requireIsolatedQaBackend(config);
  if (!/^[a-z0-9-]+$/.test(functionName)) throw new Error('QA_FUNCTION_INVALID');
  return fetchImpl(`${config.backendUrl}/functions/v1/${functionName}`, { ...options, redirect: 'error' });
}

/** Read-only attestation must succeed before any OIDC request, lease or fixture mutation. */
export async function verifyQaTestingBackend(config, fetchImpl = globalThis.fetch) {
  const response = await fetchQaBackend(config, 'qa-auth', { method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey }, body: JSON.stringify({ action: 'isolation_status' }) }, fetchImpl);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('QA_ISOLATION_ATTESTATION_FAILED');
  assertQaIsolationAttestation(config, payload);
}

export async function fetchQaOidc(config, requestUrl, bearer, fetchImpl = globalThis.fetch) {
  requireIsolatedQaBackend(config);
  if (!requestUrl || !bearer) throw new Error('GitHub OIDC environment is unavailable');
  let url;
  try { url = new URL(requestUrl); } catch { throw new Error('QA_OIDC_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['pipelines.actions.githubusercontent.com', 'oidc.actions.githubusercontent.com'].includes(url.hostname)) throw new Error('QA_OIDC_URL_INVALID');
  url.searchParams.set('audience', 'family-learning-hub-qa');
  return fetchImpl(url.href, { headers: { Authorization: `Bearer ${bearer}` }, redirect: 'error' });
}

/** Test-only served-source configuration. Repository application files stay untouched. */
export function isolatedQaSource(body, config) {
  return body.replace(/<link\b[^>]*\brel=["'](?:preconnect|dns-prefetch)["'][^>]*>/gi, '')
    .replaceAll(`https://${PRODUCTION_PROJECT_REF}.supabase.co`, config.backendUrl)
    .replaceAll(`//${PRODUCTION_PROJECT_REF}.supabase.co`, config.backendUrl)
    .replace(/sb_publishable_[A-Za-z0-9_-]+/g, config.publishableKey);
}

/** Install BEFORE fixture routes/navigation. Fixture fulfillment never reaches a backend. */
export async function installQaBrowserIsolation(context, config) {
  if (config.mode !== 'mock-local') requireIsolatedQaBackend(config);
  else if (config.backendUrl !== 'http://qa-backend.invalid') throw new Error('QA_MOCK_BACKEND_INVALID');
  const appOrigin = new URL(requireQaAppUrl(config.appUrl)).origin;
  const unexpected = [];
  let closed = false;
  // route.fetch uses Node transport rather than Chrome's per-origin connection
  // bound. Keep the local overlay within six connections (including Python previews).
  let active = 0; const waiting = [];
  const fetchAllowed = async route => {
    if (active < 6) active++; else await new Promise(resolve => waiting.push(resolve));
    try { return await route.fetch({ maxRedirects: 0 }); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
  context.on?.('close', () => { closed = true; });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const allowed = !url.username && !url.password && !isProductionQaHost(url.hostname) &&
      (url.origin === appOrigin || (config.mode !== 'mock-local' && url.origin === config.backendUrl));
    if (allowed) {
      try {
        // Browser redirect continuations can evade ordinary routing. Never follow
        // a redirect in the transport, for any resource type or backend request.
        const response = await fetchAllowed(route);
        if (response.status() >= 300 && response.status() < 400) {
          unexpected.push('QA_REDIRECT_FORBIDDEN'); return route.abort('blockedbyclient');
        }
        if (url.origin === appOrigin && ['document', 'script'].includes(request.resourceType())) {
          const headers = { ...response.headers() }; delete headers['content-length']; delete headers['content-encoding'];
          return route.fulfill({ response, headers, body: isolatedQaSource(await response.text(), config) });
        }
        return route.fulfill({ response });
      } catch {
        if (!closed) unexpected.push('QA_ALLOWED_REQUEST_FAILED');
        await route.abort('failed').catch(() => {}); return;
      }
    }
    // Store only origins: request URLs can carry learner/session/provider secrets.
    unexpected.push(url.origin);
    await route.abort('blockedbyclient');
  });
  return {
    assertNoUnexpectedRequests() { if (unexpected.length) throw new Error(`QA_UNEXPECTED_NETWORK: ${[...new Set(unexpected)].join(', ')}`); },
    unexpected,
  };
}

/** Every automatic mock harness gets the same guard, including new contexts/pages. */
export async function launchMockQaBrowser(chromium, appUrl) {
  const config = readMockQaConfig(appUrl);
  const browser = await chromium.launch(qaBrowserLaunchOptions());
  const installed = new WeakMap(), guards = [];
  const install = async context => {
    if (!installed.has(context)) {
      const guard = await installQaBrowserIsolation(context, config);
      installed.set(context, guard); guards.push(guard);
    }
  };
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser), close = browser.close.bind(browser);
  browser.newContext = async options => {
    const context = await newContext({ ...options, serviceWorkers: 'block' });
    await install(context); return context;
  };
  browser.newPage = async options => {
    const page = await newPage({ ...options, serviceWorkers: 'block' });
    await install(page.context()); return page;
  };
  browser.close = async (...args) => {
    try { for (const guard of guards) guard.assertNoUnexpectedRequests(); }
    finally { await close(...args); }
  };
  return browser;
}
