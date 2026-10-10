import { lookup } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_HOSTS } from './qa-isolation.mjs';

/** CI has installed fixed /etc/hosts denies; fail if any address can escape them. */
export async function verifyQaProductionDnsDenied(resolve = lookup, env = process.env) {
  if (env.FLH_QA_DNS_DENY_EXPECTED !== '1') throw new Error('QA_DNS_DENY_CONFIG_REQUIRED');
  for (const host of PRODUCTION_HOSTS) {
    const addresses = await resolve(host, { all: true });
    if (!addresses.length || addresses.some(item => !['127.0.0.1', '::1'].includes(item.address))) throw new Error('QA_PRODUCTION_DNS_NOT_DENIED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyQaProductionDnsDenied();
  console.log('QA Production DNS deny verified for every known backend host.');
}
