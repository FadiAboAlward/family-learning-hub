import { launchMockQaBrowser } from './qa-isolation.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE_URL=process.env.APP_URL||'http://127.0.0.1:4173/';
const DASHBOARD_DELAY_MS=Number(process.env.PARENT_DASHBOARD_DELAY_MS||1500);
const SUMMARY_DELAY_MS=Number(process.env.PARENT_SUMMARY_DELAY_MS||2500);
const LIMIT_MS=Number(process.env.PARENT_SUMMARY_VISIBLE_LIMIT_MS||3200);

const browser=await launchMockQaBrowser(chromium,BASE_URL);
const page=await browser.newPage({viewport:{width:1365,height:768}});
const errors=[];
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

let dashboardStartedAt=0, dashboardCompletedAt=0, summaryStartedAt=0, summaryCompletedAt=0;

await page.route('**/functions/v1/**',async route=>{
  const req=route.request();
  let body={};
  try{body=JSON.parse(req.postData()||'{}')}catch{}
  const slug=new URL(req.url()).pathname.split('/').pop();

  if(slug==='family-api'&&body.action==='parent_dashboard'){
    dashboardStartedAt=Date.now();
    await page.waitForTimeout(DASHBOARD_DELAY_MS);
    dashboardCompletedAt=Date.now();
    return route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({
        parent:{id:'parent',email:'parent@example.test',relation:'father',role:'owner'},
        learners:[{id:'aya-id',display_name:'آية',slug:'aya',grade_level:5},{id:'moh-id',display_name:'محمد',slug:'mohammad',grade_level:7}],
        states:[],
        attempts:[],
        reward_claims:[]
      })
    });
  }

  if(slug==='activity-api'&&body.action==='parent_session_summary'){
    summaryStartedAt=Date.now();
    await page.waitForTimeout(SUMMARY_DELAY_MS);
    summaryCompletedAt=Date.now();
    return route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({
        days:7,
        learners:[{id:'aya-id',display_name:'آية'},{id:'moh-id',display_name:'محمد'}],
        summaries:[
          {learner_id:'aya-id',sessions:4,logins:2,duration_seconds:1800,average_seconds:450,last_session_at:'2026-10-01T08:00:00Z'},
          {learner_id:'moh-id',sessions:3,logins:1,duration_seconds:1200,average_seconds:400,last_session_at:'2026-10-01T07:30:00Z'}
        ]
      })
    });
  }

  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
});

await page.addInitScript(()=>{
  localStorage.setItem('parent_session',JSON.stringify({access_token:'parent-performance-token',refresh_token:'refresh'}));
  localStorage.removeItem('learner_session');
  sessionStorage.removeItem('learner_session');
});

const started=Date.now();
await page.goto(`${BASE_URL}?parent-prefetch=${Date.now()}#parents`,{waitUntil:'domcontentloaded',timeout:30000});
await page.getByText('ملخص آخر 7 أيام',{exact:false}).waitFor({state:'visible',timeout:10000});
const summaryVisibleMs=Date.now()-started;

const serialExpectedMs=DASHBOARD_DELAY_MS+SUMMARY_DELAY_MS;
const overlapSavedMs=serialExpectedMs-summaryVisibleMs;
const requestsOverlapped=Boolean(summaryStartedAt&&dashboardCompletedAt&&summaryStartedAt<dashboardCompletedAt);

const report={
  generated_at:new Date().toISOString(),
  base_url:BASE_URL,
  injected_dashboard_delay_ms:DASHBOARD_DELAY_MS,
  injected_summary_delay_ms:SUMMARY_DELAY_MS,
  serial_expected_ms:serialExpectedMs,
  summary_visible_ms:summaryVisibleMs,
  overlap_saved_ms:overlapSavedMs,
  requests_overlapped:requestsOverlapped,
  request_timing:{
    dashboard_started_offset_ms:dashboardStartedAt-started,
    dashboard_completed_offset_ms:dashboardCompletedAt-started,
    summary_started_offset_ms:summaryStartedAt-started,
    summary_completed_offset_ms:summaryCompletedAt-started
  },
  browser_errors:errors
};

fs.writeFileSync('parent-prefetch-performance-report.json',JSON.stringify(report,null,2));
const failures=[];
if(!requestsOverlapped)failures.push('parent summary did not overlap parent dashboard request');
if(summaryVisibleMs>LIMIT_MS)failures.push(`summary visible ${summaryVisibleMs}ms exceeded ${LIMIT_MS}ms`);
if(overlapSavedMs<700)failures.push(`measured overlap saving only ${overlapSavedMs}ms`);
if(errors.length)failures.push(...errors);

const md=[
  '## Parent dashboard prefetch performance',
  '',
  `Injected parent dashboard delay: **${DASHBOARD_DELAY_MS} ms**`,
  `Injected activity summary delay: **${SUMMARY_DELAY_MS} ms**`,
  `Serial baseline for the same delays: **${serialExpectedMs} ms**`,
  `Measured summary visible: **${summaryVisibleMs} ms**`,
  `Measured time saved vs serial: **${overlapSavedMs} ms**`,
  `Requests overlapped: **${requestsOverlapped?'PASS':'FAIL'}**`,
  failures.length?`\n❌ ${failures.join('; ')}`:'\n✅ Parent summary prefetch performance regression passed.'
].join('\n');
fs.writeFileSync('parent-prefetch-performance-summary.md',md);
console.log(md);

await browser.close();
if(failures.length)throw new Error(`Parent prefetch performance regression: ${failures.join('; ')}`);
