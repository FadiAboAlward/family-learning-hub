// The pilot intentionally accepts only the independently approved Free Testing project.
export const TESTING_ORIGIN='https://gzfbkudvvxthbhjsmwsc.supabase.co';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function consentConfiguration(config) {
  if(config?.url!==TESTING_ORIGIN || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key||'') || !uuid.test(config.clientId||'')) throw new Error('CONSENT_NOT_CONFIGURED');
  const callback=new URL(config.callback);
  if(callback.origin!=='https://chatgpt.com' || !/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(callback.pathname)
    || callback.username || callback.password || callback.search || callback.hash || callback.href!==config.callback) throw new Error('INVALID_CALLBACK');
  return config;
}

export function authorizationId(search) {
  const ids=new URLSearchParams(search).getAll('authorization_id');
  // GoTrue's public authorization_id is SecureAlphanumeric(32); client IDs remain UUIDs.
  if(ids.length!==1 || !/^[A-Za-z0-9]{32}$/.test(ids[0])) throw new Error('INVALID_AUTHORIZATION');
  return ids[0];
}

export function consentDetails(data,id,userId,config) {
  if(data?.authorization_id!==id || data.client?.id!==config.clientId || data.user?.id!==userId
    || data.redirect_uri!==config.callback || data.scope!=='openid') throw new Error('AUTHORIZATION_MISMATCH');
  return {name:String(data.client.name||'ChatGPT'),scope:data.scope,callback:data.redirect_uri};
}

export function consentRedirect(value,config) {
  const url=new URL(value);
  if(url.origin+url.pathname!==config.callback || url.username || url.password || url.hash) throw new Error('INVALID_CALLBACK');
  return url.href;
}

async function start() {
  const element=id=>document.getElementById(id), message=element('message');
  const fail=()=>{message.textContent='تعذر متابعة الربط. ابدأ طلب ربط جديدًا من ChatGPT، وتأكد من حساب Testing وصلاحياته.';};
  let client,config,id,userId;
  try {
    id=authorizationId(location.search);
    const response=await fetch('./config.json',{cache:'no-store'});
    if(!response.ok) throw new Error('CONSENT_NOT_CONFIGURED');
    config=consentConfiguration(await response.json());
    client=window.supabase.createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    message.textContent='';element('login').hidden=false;
  } catch { fail();return; }
  const pending=value=>document.querySelectorAll('button').forEach(button=>{button.disabled=value;});
  element('login').addEventListener('submit',async event=>{
    event.preventDefault();pending(true);message.textContent='';
    try {
      const password=element('password').value;element('password').value='';
      const login=await client.auth.signInWithPassword({email:element('email').value.trim(),password});
      if(login.error) throw login.error;
      const user=await client.auth.getUser();
      if(user.error || !user.data?.user?.id) throw new Error('AUTH_REQUIRED');
      userId=user.data.user.id;
      const membership=await client.from('workspace_members').select('role').eq('workspace_id','55f9224c-8ba7-4cbc-9f88-713e6a6b41df').eq('user_id',userId).maybeSingle();
      if(membership.error || !['owner','admin'].includes(membership.data?.role)) throw new Error('PARENT_REQUIRED');
      const result=await client.auth.oauth.getAuthorizationDetails(id);
      if(result.error) throw result.error;
      // A previously consented grant may already return a redirect. Still show a deliberate Continue action.
      if(!('authorization_id' in (result.data||{}))) {
        const redirect=consentRedirect(result.data?.redirect_url,config);
        element('client-name').textContent='ChatGPT — ربط سبق اعتماده';element('scopes').textContent='openid';element('callback').textContent=config.callback;
        element('approve').textContent='متابعة الربط';element('approve').onclick=()=>location.assign(redirect);
        element('deny').onclick=async()=>{await client.auth.signOut({scope:'local'}).catch(()=>{});location.replace('./');};
      } else {
        const details=consentDetails(result.data,id,userId,config);
        element('client-name').textContent=details.name;element('scopes').textContent=details.scope;element('callback').textContent=details.callback;
        const decide=async approve=>{
          pending(true);
          try {
            const result=await client.auth.oauth[approve?'approveAuthorization':'denyAuthorization'](id,{skipBrowserRedirect:true});
            if(result.error) throw result.error;
            location.assign(consentRedirect(result.data?.redirect_url,config));
          } catch {
            await client.auth.signOut({scope:'local'}).catch(()=>{});
            element('consent').hidden=true;element('login').hidden=false;
            fail();pending(false);
          }
        };
        element('approve').onclick=()=>decide(true);element('deny').onclick=()=>decide(false);
      }
      element('login').hidden=true;element('consent').hidden=false;
    } catch { await client.auth.signOut({scope:'local'}).catch(()=>{});fail(); }
    finally { pending(false); }
  });
}

if(typeof document!=='undefined') {
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
}
