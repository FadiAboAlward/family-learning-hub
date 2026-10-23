// Build the same static consent frontend for one explicitly configured project.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { consentConfiguration, TESTING_ORIGIN } from '../oauth/consent/consent.mjs';

export const SDK_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
export const SDK_SHA384='TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
const digest=bytes=>createHash('sha384').update(bytes).digest('base64');

/** Pure packaging boundary, also used with a visibly synthetic SDK by browser CI. */
export async function consentFiles(config,sdk,head) {
  consentConfiguration(config);
  if(!/^[0-9a-f]{40}$/.test(head||'')) throw new Error('CONSENT_HEAD_REQUIRED');
  const files=new Map([
    ['oauth/consent/index.html',await readFile(new URL('../oauth/consent/index.html',import.meta.url))],
    ['oauth/consent/consent.mjs',await readFile(new URL('../oauth/consent/consent.mjs',import.meta.url))],
    ['oauth/consent/config.json',JSON.stringify({url:config.url,key:config.key,clientId:config.clientId,callback:config.callback})],
    ['oauth/consent/supabase.js',sdk],
    ['404.html','<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Family Learning Hub</title><p>ابدأ الربط من ChatGPT.</p></html>'],
    ['_headers',`/*\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Cross-Origin-Resource-Policy: same-origin\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ${config.url}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\n`]
  ]);
  files.set('build.json',JSON.stringify({head,files:Object.fromEntries([...files].map(([name,bytes])=>[name,digest(bytes)]))},null,2));
  return files;
}

/** Verify the pinned SDK before creating a new, narrow static deployment directory. */
export async function buildConsentSite({config,outputDir,head},fetchImpl=globalThis.fetch) {
  consentConfiguration(config);
  if(!/^[0-9a-f]{40}$/.test(head||'')) throw new Error('CONSENT_HEAD_REQUIRED');
  const response=await fetchImpl(SDK_URL,{redirect:'error'});
  if(!response.ok) throw new Error('SDK_UNAVAILABLE');
  const sdk=Buffer.from(await response.arrayBuffer());
  if(digest(sdk)!==SDK_SHA384) throw new Error('SDK_INTEGRITY_FAILED');
  const files=await consentFiles(config,sdk,head);
  const output=resolve(outputDir);
  // Never overwrite or recursively delete a checkout or an earlier deployment artifact.
  await mkdir(output);
  await mkdir(join(output,'oauth','consent'),{recursive:true});
  for(const [name,bytes] of files) await writeFile(join(output,name),bytes,{flag:'wx'});
  return {head,fileCount:files.size};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(!process.argv[2]) throw new Error('CONSENT_OUTPUT_REQUIRED');
    const url=process.env.FLH_SUPABASE_URL||TESTING_ORIGIN;
    const result=await buildConsentSite({outputDir:process.argv[2],head:process.env.FLH_QA_HEAD_SHA,
      config:{url,key:process.env.FLH_PUBLISHABLE_KEY||(url===TESTING_ORIGIN?process.env.FLH_TESTING_PUBLISHABLE_KEY:undefined),clientId:process.env.FLH_ASSESSMENT_MCP_CLIENT_ID,callback:process.env.FLH_ASSESSMENT_MCP_CALLBACK}});
    console.log(`Static consent artifact: ${result.fileCount} files; source ${result.head}`);
  } catch { console.error('Consent build failed; inspect public configuration, pinned SDK and new output directory.');process.exitCode=1; }
}
