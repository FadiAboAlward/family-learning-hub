// FLH026 v1.0 / Drive revision2. Pure guard shared by QA clients and qa-auth.
export const PRODUCTION_PROJECT_REF = 'gkpoylfozvuwuwqeoduc';
export const PRODUCTION_HOSTS = Object.freeze([
  `${PRODUCTION_PROJECT_REF}.supabase.co`, `db.${PRODUCTION_PROJECT_REF}.supabase.co`,
]);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const dockerLocal = new Set(['kong', 'host.docker.internal']);

export function isProductionQaHost(hostname) {
  return String(hostname).toLowerCase().replace(/\.$/, '').split('.').includes(PRODUCTION_PROJECT_REF);
}

/** No environment defaults: a test account never establishes backend isolation. */
export function requireIsolatedQaBackend({ mode, backendUrl, projectRef } = {}) {
  if (!['runner-local', 'isolated-testing'].includes(mode) || !backendUrl || !projectRef) throw new Error('QA_ISOLATION_CONFIG_REQUIRED');
  if (String(projectRef).toLowerCase() === PRODUCTION_PROJECT_REF) throw new Error('QA_PRODUCTION_FORBIDDEN');
  let url;
  try { url = new URL(backendUrl); } catch { throw new Error('QA_ISOLATION_URL_INVALID'); }
  if (isProductionQaHost(url.hostname)) throw new Error('QA_PRODUCTION_FORBIDDEN');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('QA_ISOLATION_URL_INVALID');
  if (mode === 'runner-local') {
    if (projectRef !== 'local' || !['http:', 'https:'].includes(url.protocol) || !(loopback.has(url.hostname) || dockerLocal.has(url.hostname)) || !url.port) throw new Error('QA_ISOLATION_IDENTITY_MISMATCH');
  } else if (!/^[a-z0-9]{20}$/.test(projectRef) || url.protocol !== 'https:' || url.port || url.hostname !== `${projectRef}.supabase.co`) {
    throw new Error('QA_ISOLATION_IDENTITY_MISMATCH');
  }
  return Object.freeze({ mode, backendUrl: url.origin, projectRef });
}

export function requireQaPublishableKey(value, config) {
  if (typeof value !== 'string' || !value || value.startsWith('sb_secret_')) throw new Error('QA_PUBLISHABLE_KEY_REQUIRED');
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return value;
  let claims;
  try { claims = JSON.parse(atob(value.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))); } catch { throw new Error('QA_PUBLISHABLE_KEY_INVALID'); }
  if (claims.role !== 'anon' || claims.ref === PRODUCTION_PROJECT_REF || (config.mode === 'isolated-testing' && claims.ref !== config.projectRef)) throw new Error('QA_PUBLISHABLE_KEY_INVALID');
  return value;
}

export function requireQaAppUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('QA_APP_URL_INVALID'); }
  if (!loopback.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('QA_APP_MUST_BE_LOCAL');
  return url.href;
}

export function assertQaIsolationAttestation(config, payload) {
  const status = payload?.isolation;
  if (payload?.ok !== true || status?.mode !== config.mode || status?.project_ref !== config.projectRef || status?.backend_origin !== config.backendUrl) throw new Error('QA_ISOLATION_ATTESTATION_FAILED');
  return true;
}
