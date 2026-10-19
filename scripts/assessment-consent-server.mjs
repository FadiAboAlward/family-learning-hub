// Testing OAuth consent only. No API proxy, credentials, sessions, directory serving or request logs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { consentConfiguration,TESTING_ORIGIN } from '../oauth/consent/consent.mjs';

const sdkUrl='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const sdkSha384='TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';

export async function createConsentServer(config,sdkScript) {
  consentConfiguration(config);
  const routes=new Map([
    ['/oauth/consent',['text/html; charset=utf-8',await readFile(new URL('../oauth/consent/index.html',import.meta.url))]],
    ['/consent.mjs',['text/javascript; charset=utf-8',await readFile(new URL('../oauth/consent/consent.mjs',import.meta.url))]],
    ['/config',['application/json; charset=utf-8',JSON.stringify(config)]],
    ['/supabase.js',['text/javascript; charset=utf-8',sdkScript]]
  ]);
  const server=createServer((req,res)=>{
    const port=server.address()?.port;
    if(![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)) {res.writeHead(403).end();return;}
    const path=new URL(req.url,'http://localhost').pathname;
    const route=routes.get(path);
    const headers={
      'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ${TESTING_ORIGIN}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    };
    if(req.method!=='GET' || !route) {res.writeHead(404,headers).end();return;}
    res.writeHead(200,{'Content-Type':route[0],...headers}).end(route[1]);
  });
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const config=consentConfiguration({url:TESTING_ORIGIN,key:process.env.FLH_TESTING_PUBLISHABLE_KEY,clientId:process.env.FLH_ASSESSMENT_MCP_CLIENT_ID,callback:process.env.FLH_ASSESSMENT_MCP_CALLBACK});
    const response=await fetch(sdkUrl,{redirect:'error'});
    if(!response.ok) throw new Error('SDK_UNAVAILABLE');
    const sdk=Buffer.from(await response.arrayBuffer());
    if(createHash('sha384').update(sdk).digest('base64')!==sdkSha384) throw new Error('SDK_INTEGRITY_FAILED');
    const server=await createConsentServer(config,sdk);
    server.on('error',()=>{console.error('Testing consent server could not start.');process.exitCode=1;});
    server.listen(3000,'127.0.0.1',()=>console.log('Testing OAuth consent ready at http://localhost:3000/oauth/consent'));
  } catch { console.error('Testing consent setup unavailable; check public configuration and pinned SDK.');process.exitCode=1; }
}
