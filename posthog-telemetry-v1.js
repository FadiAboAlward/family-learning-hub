/* FLH-FEAT-2026-037 — parent-managed educational analytics, EU project 317596.
   Public PostHog project token is a publishable browser key, never a secret API key. */
(() => {
  'use strict';
  const SITE='https://fadiaboalward.github.io';
  if (location.origin!==SITE || !/^\/family-learning-hub(?:\/|$)/.test(location.pathname)) return;

  const PH_TOKEN='phc_rKwnoKHJRXXfJsqREy2HJz59zmqffsWnysUaqt3Jt4xj';
  const HOST='https://eu.i.posthog.com';
  const ALLOWED=new Set([
    'flh_route_view','flh_learning_started','flh_learning_question_viewed',
    'flh_learning_answer','flh_learning_hint','flh_learning_completed',
    'flh_exam_started','flh_exam_question_viewed','flh_exam_answer_saved',
    'flh_exam_flag_changed','flh_exam_completed','flh_learning_error','flh_exam_error'
  ]);
  const PROPERTIES=new Set([
    'route','mode','quiz_slug','attempt_id','question_id','question_index',
    'question_type','option_position','response_text','is_correct','finalized',
    'percentage','score_points','max_points','first_try_correct','hints_used',
    'hint_level','duration_seconds','xp','reward_points','resumed','flagged',
    'error_type','question_count','question_text'
  ]);
  const secretKey=/(?:token|secret|password|passwd|pin|cookie|authorization|api.?key|jwt|session.?key|request.?body|response.?body)/i;
  const redactString=(value,max=300)=>String(value).slice(0,max)
    .replace(/Bearer\s+\S+/gi,'[redacted]')
    .replace(/(?:eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]');
  const safeRoute=()=>location.hash.split('?')[0].slice(0,90).replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id')||'#home';
  function scrub(event) {
    if (!event || !event.properties || typeof event.properties!=='object') return event;
    const props=event.properties;
    for (const key of Object.keys(props)) {
      if (secretKey.test(key) && !(key==='token' && props[key]===PH_TOKEN)) { delete props[key]; continue; }
      if (typeof props[key]==='string') {
        if (/url|referrer|href/i.test(key)) {
          try { const url=new URL(props[key],location.origin);props[key]=url.origin+url.pathname; }
          catch { delete props[key]; }
        } else props[key]=redactString(props[key],1200);
      }
    }
    return event;
  }
  function capture(event, data={}) {
    if (!ALLOWED.has(event) || !data || typeof data!=='object') return;
    const payload={};
    for (const [key,value] of Object.entries(data)) {
      if (!PROPERTIES.has(key) || value==null || secretKey.test(key)) continue;
      if (typeof value==='string') payload[key]=redactString(value,key==='response_text'||key==='question_text'?500:140);
      else if (typeof value==='boolean' || (typeof value==='number'&&Number.isFinite(value))) payload[key]=value;
    }
    try { window.posthog?.capture?.(event,payload); } catch { /* analytics never affects learning */ }
  }
  let activeLearner='';
  function identifyLearner(learner) {
    if (!learner || typeof learner!=='object') return;
    const id=String(learner.id||learner.slug||'').slice(0,90);
    if (!id || !/^[\w-]+$/.test(id)) return;
    if (activeLearner===id) return;
    try {
      if (activeLearner) window.posthog?.reset?.();
      window.posthog?.identify?.('flh-learner:'+id,{role:'student',learner_slug:redactString(learner.slug||'',70)});
      activeLearner=id;
    } catch { /* no learner blocking */ }
  }
  function resetLearner() {
    activeLearner='';
    try { window.posthog?.reset?.(); } catch {}
  }
  window.FLHTelemetry=Object.freeze({capture,identifyLearner,resetLearner,enabled:true});
  // PostHog's official queue-first HTML snippet: SDK loads asynchronously.
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split('.');2===o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)));};}(p=t.createElement('script')).type='text/javascript',p.async=true,p.src=s.api_host.replace('.i.posthog.com','-assets.i.posthog.com')+'/static/array.js',(r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e;},u.people.toString=function(){return u.toString(1)+'.people (stub)';},o='init capture identify alias people.set people.set_once group reset resetGroups set_config startSessionRecording stopSessionRecording get_distinct_id register register_once unregister opt_in_capturing opt_out_capturing'.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a]);},e.__SV=1);}(document,window.posthog||[]);
  window.posthog.init(PH_TOKEN,{
    api_host:HOST,
    ui_host:'https://eu.posthog.com',
    defaults:'2025-05-24',
    person_profiles:'identified_only',
    capture_pageview:true,
    capture_pageleave:true,
    autocapture:true,
    disable_session_recording:false,
    capture_performance:true,
    session_recording:{
      maskAllInputs:true,
      maskTextSelector:'.ph-mask,.flh-sensitive',
      blockSelector:'.ph-no-capture,[data-flh-private]'
    },
    before_send:scrub
  });
  let previousRoute='';
  function onRoute() {
    const route=safeRoute();
    if (route!==previousRoute) {previousRoute=route;capture('flh_route_view',{route});}
  }
  window.addEventListener('hashchange',onRoute);
  onRoute();
})();
