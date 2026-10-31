import { launchMockQaBrowser } from './qa-isolation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// FLH024 v1.1/revision2 + FLH022 v1.1/revision3, preserving FLH018 v1.5.
// Provider rendering is intentionally mocked; live ads/navigation/tablet QA is separate.
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const OUTPUT_DIR = 'playwright-screenshots';
const screenshotFiles = [];
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111112';
const VIDEO_ID = '11111111-1111-4111-8111-111111111113';
const ALLOWED_REPORTS = ['not_reported', 'not_watched', 'watched_part', 'watched_full'];
const REPORT_KEYS = ['action', 'attempt_id', 'video_id', 'self_report', 'expected_revision', 'request_id'];
const LEARNER = { id: '11111111-1111-4111-8111-111111111111', slug: 'test', display_name: 'طالب الاختبار', grade_level: 7, is_test: true, avatar_emoji: '🧪' };
const profile = { learner: LEARNER, gamification: { xp: 100, reward_points: 20, current_level: 1, current_streak: 1, longest_streak: 1, badges: [], rewards: [] } };
const clone = value => structuredClone(value);
const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

function videoFixture(overrides = {}) {
  return {
    id: VIDEO_ID, provider: 'youtube', video_ref: 'qaVideo0001', title: 'Tam sayılar — testing explanation', language: 'tr',
    made_for_kids: false, verification_expires_at: '2099-10-02T10:00:00Z', availability: 'available',
    self_report: 'not_reported', report_revision: 0, only_before_first_question: true, ...overrides,
  };
}

function createFixture({ video = videoFixture(), previewVideo = video, language = 'tr', resumed = false, progressed = false, typedDraft = null, catalog = null, history = null, progressStore = null } = {}) {
  const calls = [];
  const reportResults = new Map();
  let failure = null;
  let delayPromise = null;
  let releaseDelay;
  let started = resumed;
  const typed = typeof typedDraft === 'string';
  const row = {
    question_id: 'qa-optional-video-question', source_role: 'core', status: 'active',
    draft_option_position: typed ? null : (progressed ? 1 : null),
    draft_response: typed ? { value: typedDraft } : null,
    hint_level_requested: 0,
    question: { id: 'qa-optional-video-question', question_code: 'QA-OPTIONAL-VIDEO', prompt_language: language,
      question_type: typed ? 'numeric' : 'single_choice',
      prompt: language === 'ar' ? 'احسب: 19 - (-7)' : '19 - (-7) işleminin sonucu nedir?',
      options: typed ? [] : [{ position: 1, content: '26' }, { position: 2, content: '-26' }], assets: [] },
  };
  return {
    calls, row, video,
    last: action => calls.filter(call => call.action === action).at(-1),
    count: action => calls.filter(call => call.action === action).length,
    fail: (kind = 'before', status = 500, error = 'VIDEO_REPORT_TEMPORARILY_UNAVAILABLE') => { failure = { kind, status, error }; },
    delay: () => { delayPromise = new Promise(resolve => { releaseDelay = resolve; }); },
    release: () => { releaseDelay?.(); delayPromise = null; },
    async handle(endpoint, body) {
      calls.push({ endpoint, ...clone(body) });
      if (endpoint === 'family-api') {
        if (body.action === 'student_profile') return { body: clone(profile) };
        if (body.action === 'learner_choices') return { body: { learners: [LEARNER] } };
        return { body: { ok: true } };
      }
      if (endpoint === 'student-library-api') return { body: catalog || { programs: [], standalone_books: [] } };
      if (endpoint === 'attempt-history-api') return {body:body.action==='attempt_detail'?history:{items:history?[history.attempt]:[],has_more:false}};
      if (endpoint === 'activity-api') return { body: { ok: true } };
      if (endpoint === 'question-reference-api') return { body: { codes: {} } };
      if (endpoint === 'exam-v2-api') {
        if (body.action === 'start_exam') return { body: { attempt_id: 'qa-video-exam', resumed: false, quiz: { slug: 'qa-video', title: 'امتحان الاختبار' }, questions: [{ ...clone(row), saved_response: null, is_flagged: false }] } };
        if (body.action === 'submit_exam') return { body: { percentage: 100, score_points: 1, max_points: 1, review: [] } };
        return { body: { ok: true } };
      }
      assert.equal(endpoint, 'learning-api', 'mock never forwards an unrecognized API to a live backend');
      if(['get_video_progress','save_video_progress','clear_video_progress'].includes(body.action)){
        if(!progressStore)return {body:{eligible:false}};
        const item=(Array.isArray(previewVideo.videos)?previewVideo.videos:[previewVideo]).find(item=>item.id===body.video_id);
        if(!item||item.made_for_kids!==false||Date.parse(item.verification_expires_at)<Date.now())return {body:{eligible:false}};
        let saved=progressStore.get(item.video_ref)||{eligible:true,eligible_until:item.verification_expires_at,revision:0,position_seconds:0,ended:false,has_progress:false};
        if(body.action==='get_video_progress')return {body:clone(saved)};
        if(delayPromise)await delayPromise;
        const injected=failure;failure=null;
        if(injected?.kind==='before')return {body:{error:injected.error},status:injected.status};
        if(saved.request_id!==body.request_id){
          if(saved.revision!==body.expected_revision)return {body:{error:'VIDEO_PROGRESS_CONFLICT'},status:409};
          saved={...saved,revision:saved.revision+1,request_id:body.request_id,position_seconds:body.position_seconds||0,ended:body.ended||false,has_progress:body.action!=='clear_video_progress'};
          progressStore.set(item.video_ref,saved);
        }
        if(injected?.kind==='after')return {body:{error:injected.error},status:injected.status};
        return {body:clone(saved)};
      }
      if (body.action === 'preview_videos') {
        return { body: { quiz_version_id: '11111111-1111-4111-8111-111111111115', resumable_attempt_id: started ? ATTEMPT_ID : null, quiz: { slug: 'qa-video', title: 'تدريب الاختبار' }, optional_video: clone(previewVideo) } };
      }
      if (body.action === 'start_quiz') {
        const response = { attempt_id: ATTEMPT_ID, resumed: started, quiz: { slug: 'qa-video', title: 'تدريب الاختبار' }, queue: [clone(row)], optional_video: clone(video) };
        started = true;
        return { body: response };
      }
      if (body.action === 'save_video_report') {
        assert.ok(video, 'no viewing report without a video');
        const reportVideo = (Array.isArray(video.videos) ? video.videos : [video]).find(item => item.id === body.video_id);
        assert.ok(reportVideo, 'report is scoped to one video from the current sequence');
        assert.deepEqual(Object.keys(body).sort(), REPORT_KEYS.slice().sort(), 'report contains only explicit self-report and concurrency identifiers');
        assert.equal(body.attempt_id, ATTEMPT_ID);
        assert.ok(ALLOWED_REPORTS.includes(body.self_report), 'only explicit supported self-report values');
        assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'stable request UUID');
        if (delayPromise) await delayPromise;
        const injected = failure;
        failure = null;
        if (injected?.kind === 'before') return { body: { error: injected.error, self_report: reportVideo.self_report, report_revision: reportVideo.report_revision }, status: injected.status };
        let result = reportResults.get(body.request_id);
        if (!result) {
          if (body.expected_revision !== reportVideo.report_revision) return { body: { error: 'REPORT_CONFLICT', self_report: reportVideo.self_report, report_revision: reportVideo.report_revision }, status: 409 };
          reportVideo.self_report = body.self_report;
          reportVideo.report_revision += 1;
          result = { ok: true, self_report: reportVideo.self_report, report_revision: reportVideo.report_revision };
          reportResults.set(body.request_id, clone(result));
        }
        if (injected?.kind === 'after') return { body: { error: injected.error }, status: injected.status };
        return { body: clone(result) };
      }
      if (body.action === 'save_draft') { row.draft_option_position = body.option_position; return { body: { ok: true } }; }
      if (body.action === 'request_hint') { row.hint_level_requested=1;return {body:{hint_level:1,hint:{hint_level:1,content:'فكّر في خط الأعداد',language:'ar'}}}; }
      if (body.action === 'save_response_draft') { row.draft_response = clone(body.response); return { body: { ok: true, response: clone(body.response) } }; }
      if (body.action === 'clear_response_draft') { row.draft_response = null; return { body: { ok: true, cleared: true } }; }
      if (body.action === 'answer') { row.status = 'completed'; return { body: { is_correct: true, finalized: true, explanation: '19 - (-7) = 26' } }; }
      if (body.action === 'finish_quiz') return { body: { percentage: 100, first_try_correct: 1, hints_used: 0, award: { already_awarded: true }, review: [] } };
      throw new Error(`Unconfigured synthetic Learning action: ${body.action}`);
    },
  };
}

// This stub treats attempted telemetry access as a product error, rather than silently
// handing back fake times. Only readiness/error events are valid in the v1.1 contract.
const PROVIDER_SCRIPT = `(() => {
  const fixture = window.__qaVideoProvider;
  window.YT = { Player: function(id, options) {
    const element = typeof id === 'string' ? document.getElementById(id) : id;
    const player = this;
    fixture.instances.push(player);
    fixture.events.push(...Object.keys(options.events || {}));
    player.options = options;
    player.frame = element?.tagName === 'IFRAME' ? element : element?.querySelector('iframe');
    player.getIframe = () => player.frame;
    player.destroy = () => { player.destroyed = true; fixture.destroyed += 1; };
    for (const name of ['getCurrentTime', 'getDuration', 'getPlayerState', 'getVideoLoadedFraction', 'getVideoData']) {
      player[name] = () => { fixture.metrics.push(name); throw new Error('Player-derived telemetry is forbidden'); };
    }
    if(fixture.mode==='resume'){
      player.getCurrentTime=()=>{fixture.metrics.push('getCurrentTime');return fixture.time||0;};
      player.seekTo=value=>{fixture.metrics.push('seekTo');fixture.seek=value;};
    }
    player.addEventListener = name => { fixture.events.push(name); if (!['onReady', 'onError'].includes(name)) throw new Error('Player tracking is forbidden'); };
    fixture.fire = (event, data) => { if (!player.destroyed) options.events?.[event]?.({ target: player, data }); };
    if (fixture.mode === 'sync-error') fixture.fire('onError', 150);
    else if (fixture.mode !== 'pending') setTimeout(() => fixture.fire(fixture.mode === 'error' ? 'onError' : 'onReady', fixture.mode === 'error' ? 150 : undefined), 0);
  }};
  window.onYouTubeIframeAPIReady?.();
})();`;

async function setup(browser, device, options = {}) {
  const context = await browser.newContext({ viewport: device.viewport, ...(device.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  const fixture = createFixture(options);
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const failedResponses = [];
  const injectedFailures = [];
  const providerRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push({ pathname: new URL(request.url()).pathname, reason: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) failedResponses.push({ pathname: new URL(response.url()).pathname, status: response.status() }); });
  await page.addInitScript(mode => {
    localStorage.setItem('learner_session', 'mock.optional-video-testing-session');
    window.__qaVideoProvider = { mode, instances: [], events: [], metrics: [], destroyed: 0 };
  }, options.providerMode || 'ready');
  await context.route('**/functions/v1/*', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = route.request().postDataJSON() || {};
    const result = await fixture.handle(endpoint, body);
    if (result.status >= 400) injectedFailures.push(result.status);
    return json(route, result.body, result.status || 200);
  });
  await context.route(/https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/.*/, async route => {
    const url = new URL(route.request().url());
    providerRequests.push({ pathname: url.pathname, search: url.search });
    if (url.pathname === '/iframe_api') {
      if (options.providerMode === 'network-error') { injectedFailures.push('net::ERR_FAILED'); return route.abort('failed'); }
      if (options.providerMode === 'api-delay') await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: PROVIDER_SCRIPT });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Synthetic Testing embed</title><body>Testing provider fixture</body></html>' });
  });
  const target = options.initialPath ? `${APP_URL}${options.initialPath}` : `${APP_URL}?optional-video-testing#student`;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.FLH?.startLearningQuiz === 'function' && typeof window.FLH?.startExamQuiz === 'function');
  return {
    context, page, fixture, providerRequests,
    async verifyAndClose(label) {
      assert.deepEqual(pageErrors, [], `${label}: no page errors`);
      const unexpectedConsole = consoleErrors.filter(message => !injectedFailures.length || !/^Failed to load resource: (?:the server responded with a status of (?:409|500)|net::ERR_FAILED)/.test(message));
      assert.deepEqual(unexpectedConsole, [], `${label}: no unexpected console errors`);
      assert.deepEqual(failedRequests.filter(request => request.reason !== 'net::ERR_ABORTED' && !(options.providerMode === 'network-error' && request.pathname === '/iframe_api')), [], `${label}: no unexpected failed network requests`);
      assert.deepEqual(failedResponses.filter(response => response.pathname !== '/functions/v1/learning-api' || !injectedFailures.includes(response.status)), [], `${label}: HTTP failures match only injected report cases`);
      const tracking = await page.evaluate(() => ({ events: window.__qaVideoProvider.events, metrics: window.__qaVideoProvider.metrics }));
      if(options.providerMode!=='resume'){
        assert.deepEqual(tracking.metrics, [], `${label}: no player-derived metric access without eligible opt-in`);
        assert.ok(tracking.events.every(event => ['onReady', 'onError'].includes(event)), `${label}: no player-state/seek/ended tracking listeners`);
      }else assert.ok(tracking.metrics.every(metric=>['getCurrentTime','seekTo'].includes(metric)),'resume reads no unrelated player metrics');
      assert.deepEqual(fixture.calls.filter(call => call.endpoint === 'family-api' && !['student_profile', 'learner_choices'].includes(call.action)), [], `${label}: video flow never sends reward or balance commands`);
      await context.close();
    },
  };
}

const start = page => page.evaluate(() => window.FLH.startLearningQuiz('qa-video'));
const reportResponse = page => page.waitForResponse(response => response.url().endsWith('/learning-api') && response.request().postDataJSON()?.action === 'save_video_report');
const questionReady = page => page.locator('.flh-learn-answer').first().waitFor({ state: 'visible' });

async function layout(page, language, label) {
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl', `${label}: Arabic shell remains RTL`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal overflow`);
  const card = page.locator('#flhOptionalVideo');
  const select = page.locator('#flhVideoReport');
  assert.ok(await select.evaluate(element => Boolean(element.labels?.length || element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'))), `${label}: self-report control has accessible label`);
  assert.match(await card.innerText(), /اختياري/);
  assert.match(await card.innerText(), /(?:تقريرك|بنفسك|إفادتك|ذاتي|شخصي)/, `${label}: source is clearly learner self-report`);
  assert.equal(await page.locator('#flhVideoStart').isEnabled(), true, `${label}: Start is immediately available`);
  assert.ok(await page.locator('#flhVideoStart').evaluate(element => element.getBoundingClientRect().height >= 44), `${label}: Start has a usable touch target`);
  assert.equal(await page.locator('#flhVideoReportStatus').getAttribute('role'), 'status', `${label}: save status is announced accessibly`);
  const title = card.locator('[lang]').first();
  assert.equal(await title.getAttribute('lang'), language, `${label}: provider title language`);
  assert.equal(await title.evaluate(element => getComputedStyle(element).direction), language === 'ar' ? 'rtl' : 'ltr', `${label}: provider title direction`);
  const options = await select.locator('option').evaluateAll(elements => elements.map(element => element.value));
  assert.deepEqual(options, ALLOWED_REPORTS, `${label}: optional explicit self-report vocabulary`);
}

async function screenshot(page, name) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: `${OUTPUT_DIR}/${name}.png`, fullPage: true });
  screenshotFiles.push(`${name}.png`);
}

async function authoredOutcomes(browser, device) {
  const firstOutcomes=['تقارن: 1/2 + 3/4 = 5/4','تشرح كيف تجمع كسرين بمقامين مختلفين'];
  const secondOutcomes=['Sayı doğrusunda -3 + 5 sonucunu bulursun'];
  const first=videoFixture({position:1,language:'ar',title:'درس كسور الاختبار',learning_outcomes:firstOutcomes});
  const second=videoFixture({id:'11111111-1111-4111-8111-111111111114',position:2,video_ref:'qaVideo0002',language:'tr',title:'Sayı doğrusu',learning_outcomes:secondOutcomes});
  const legacy=videoFixture({id:'11111111-1111-4111-8111-111111111115',position:3,video_ref:'qaVideo0003',language:'ar',title:'درس قديم بلا أهداف'});
  const malformed=videoFixture({id:'11111111-1111-4111-8111-111111111116',position:4,video_ref:'qaVideo0004',language:'ar',title:'بيانات اختيارية غير صالحة',learning_outcomes:['<script>unsafe</script>']});
  const test=await setup(browser,device,{video:{...clone(first),videos:[first,second,legacy,malformed]},language:'ar',providerMode:'api-delay'});
  const {page,fixture}=test;
  try{
    await start(page);await page.locator('#flhOptionalVideo').waitFor({state:'visible'});
    // The shared math renderer stacks fractions visually; textContent omits their slash.
    // Compare the accessible original notation and verify actual numerator/denominator markup.
    const renderedOutcomes=await page.locator('.flh-video-outcomes li').evaluateAll(rows=>rows.map(row=>{
      const semanticText=node=>{
        if(node.nodeType===Node.TEXT_NODE)return node.nodeValue;
        if(node.nodeType!==Node.ELEMENT_NODE)return '';
        if(node.matches('bdi[role="math"][aria-label]'))return node.getAttribute('aria-label');
        return Array.from(node.childNodes).map(semanticText).join('');
      };
      return semanticText(row);
    }));
    assert.deepEqual(renderedOutcomes,firstOutcomes,'Active video preserves each vetted outcome including accessible fraction notation');
    assert.deepEqual(await page.locator('.flh-video-outcomes .frac .n').allTextContents(),['1','3','5'],'Fraction numerators retain their exact authored values');
    assert.deepEqual(await page.locator('.flh-video-outcomes .frac .d').allTextContents(),['2','4','4'],'Fraction denominators retain their exact authored values');
    const heading=page.getByRole('heading',{name:'ماذا ستتعلم؟'});assert.equal(await heading.count(),1);
    assert.equal(await page.locator('.flh-video-outcomes').getAttribute('aria-labelledby'),await heading.getAttribute('id'),'Outcomes region has an accessible title');
    assert.ok(await page.locator('.flh-video-outcomes').evaluate(element=>element.compareDocumentPosition(document.querySelector('.flh-video-player'))&Node.DOCUMENT_POSITION_FOLLOWING),'Outcomes precede the player');
    assert.ok(await page.locator('.flh-video-outcomes bdi[dir="ltr"]').count()>0,'Mixed Arabic math uses existing LTR isolation');
    assert.equal(await page.locator('.flh-video-outcomes ul').evaluate(element=>getComputedStyle(element).direction),'rtl');
    await screenshot(page,`optional-video-${device.name}-outcomes-ar`);
    await page.locator('.flh-video-sequence-item').nth(1).click();
    assert.deepEqual(await page.locator('.flh-video-outcomes li').allTextContents(),secondOutcomes,'Rapid switch cannot retain the preceding video outcome');
    assert.equal(await page.locator('.flh-video-outcomes ul').getAttribute('lang'),'tr');
    assert.equal(await page.locator('.flh-video-outcomes ul').evaluate(element=>getComputedStyle(element).direction),'ltr');
    await page.waitForFunction(()=>window.__qaVideoProvider.instances.length>=1);
    assert.deepEqual(await page.locator('.flh-video-outcomes li').allTextContents(),secondOutcomes,'Late provider initialization cannot change the active outcomes');
    await screenshot(page,`optional-video-${device.name}-outcomes-tr`);
    await page.locator('.flh-video-sequence-item').nth(2).click();
    assert.equal(await page.locator('.flh-video-outcomes').count(),0,'Legacy missing outcomes produces no fabricated summary');
    assert.equal(await page.locator('#flhVideoStart').isEnabled(),true);await screenshot(page,`optional-video-${device.name}-outcomes-legacy`);
    await page.locator('.flh-video-sequence-item').nth(3).click();
    assert.equal(await page.locator('.flh-video-outcomes').count(),0,'Malformed optional outcomes retain Watch/Skip without an error card');
    assert.equal(await page.locator('#flhOptionalVideo script').count(),0,'Optional metadata cannot inject markup');
    assert.doesNotMatch(await page.locator('#flhOptionalVideo').innerText(),/unsafe/);
    assert.equal(await page.getByRole('button',{name:/استعداد|أسئلة سريعة|quick check/i}).count(),0,'No readiness action is invented without its approved independent prerequisites');
    assert.equal(fixture.count('save_video_report'),0);assert.equal(fixture.count('start_quiz'),1,'Video navigation adds no formal attempt calls');
    assert.equal(fixture.count('answer')+fixture.count('save_draft')+fixture.count('finish_quiz'),0,'Outcomes and navigation never grade or save academic activity');
    assert.equal(fixture.row.draft_option_position,null,'No answer is written by outcomes');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Compact outcomes and optional fallback have no horizontal overflow');
    await screenshot(page,`optional-video-${device.name}-outcomes-malformed`);
    await page.locator('#flhVideoStart').click();await questionReady(page);
    assert.equal(await page.locator('.flh-video-outcomes').count(),0,'Starting Learning disposes the optional outcomes surface');
    await test.verifyAndClose(`${device.name} authored outcomes`);
  }catch(error){await test.context.close();throw error;}
}

async function previewThenFrozenOutcomes(browser, device) {
  const frozenOutcomes=['تقارن كسرين باستخدام أجزاء متساوية'];
  const currentOutcomes=['تجمع كسرين باستخدام مقام مشترك'];
  const frozen=videoFixture({title:'الدرس المثبت للمحاولة',language:'ar',learning_outcomes:frozenOutcomes});
  const current=videoFixture({id:'11111111-1111-4111-8111-111111111119',title:'نسخة الدرس الحالية',language:'ar',learning_outcomes:currentOutcomes});
  const test=await setup(browser,device,{video:frozen,previewVideo:current,language:'ar',resumed:true,initialPath:'?quiz=qa-video&mode=learning&learner=test&videos=1#student'});
  const {page,fixture}=test;
  try {
    await page.locator('#flhOptionalVideo').waitFor({state:'visible'});
    assert.deepEqual(await page.locator('.flh-video-outcomes li').allTextContents(),currentOutcomes,'Read-only preview renders current authorized assignment outcomes');
    assert.equal(fixture.count('start_quiz'),0,'Current preview does not create or snapshot an attempt');
    assert.equal(await page.locator('#flhVideoReport').count(),0,'Current preview has no report persistence controls');
    await page.locator('#flhVideoStart').click();
    await page.waitForFunction(()=>document.querySelector('#flhVideoLesson h3')?.textContent==='الدرس المثبت للمحاولة');
    assert.deepEqual(await page.locator('.flh-video-outcomes li').allTextContents(),frozenOutcomes,'Normal resume renders its frozen outcomes rather than current preview metadata');
    assert.equal(fixture.count('start_quiz'),1);assert.equal(fixture.count('save_video_report'),0);
    assert.equal(fixture.row.draft_option_position,null,'Preview and frozen resume do not write an academic answer');
    await screenshot(page,`optional-video-${device.name}-outcomes-frozen-resume`);
    await page.locator('#flhVideoStart').click();await questionReady(page);
    await test.verifyAndClose(`${device.name} current preview versus frozen outcomes`);
  } catch(error) { await test.context.close();throw error; }
}

async function explicitReports(browser, device) {
  const test = await setup(browser, device);
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    await layout(page, 'tr', `${device.name} optional video`);
    await page.waitForFunction(() => window.__qaVideoProvider.instances.length === 1);
    const frame = page.locator('#flhVideoFrame');
    assert.ok(await frame.getAttribute('title'), 'iframe has accessible title');
    const src = new URL(await frame.getAttribute('src'));
    assert.equal(src.hostname, 'www.youtube-nocookie.com', 'privacy-enhanced embed');
    assert.ok(!src.searchParams.has('autoplay') || src.searchParams.get('autoplay') === '0', 'no autoplay');
    assert.equal(src.searchParams.get('rel'), '0', 'supported related-content setting');
    assert.equal(fixture.count('save_video_report'), 0, 'loading the player creates no viewing evidence');
    // Forged/ended player messages must not turn into viewing evidence.
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.youtube-nocookie.com', data: JSON.stringify({ event: 'onStateChange', info: 0 }) }));
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.youtube-nocookie.com', data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 120, duration: 120, playerState: 0 } }) }));
    });
    await screenshot(page, `optional-video-${device.name}-ltr`);
    assert.equal(fixture.count('save_video_report'), 0, 'ended/time events create no automatic report');
    for (const value of ['not_watched', 'watched_part', 'watched_full', 'not_reported']) {
      await page.locator('#flhVideoReport').selectOption(value);
      assert.equal(fixture.last('save_video_report')?.self_report === value, false, 'selection alone never persists evidence');
      const saved = reportResponse(page);
      await page.locator('#flhVideoSave').click();
      assert.equal((await saved).status(), 200);
      await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
      assert.equal(fixture.video.self_report, value, 'only learner explicit Save persists self-report');
      assert.equal(await page.locator('#flhVideoReport').inputValue(), value);
    }
    assert.equal(fixture.video.report_revision, 4, 'one revision per explicit edit');
    await page.evaluate(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 300000;
    }); // Five minutes on the optional card are not academic solving time.
    if (device.name === 'mobile') await page.locator('#flhVideoStart').tap();
    else await page.locator('#flhVideoStart').press('Enter');
    await questionReady(page);
    assert.equal(await page.locator('#flhOptionalVideo').count(), 0);
    assert.equal(await page.locator('#flhVideoFrame').count(), 0, 'practice removes playback surface');
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.destroyed), 1, 'practice destroys provider instance');
    assert.equal(fixture.count('save_video_report'), 4, 'start creates no additional report');
    await page.locator('.flh-learn-answer').first().click();
    await page.locator('#flhConfirmAnswer').click();
    await page.locator('#flhLearnNext').waitFor({ state: 'visible' });
    await page.locator('#flhLearnNext').click();
    await page.locator('#learnHome').waitFor({ state: 'visible' });
    assert.equal(fixture.count('answer'), 1, 'original server-authoritative Learning flow still runs');
    assert.equal(fixture.count('finish_quiz'), 1);
    assert.ok(fixture.last('finish_quiz').duration_seconds >= 1 && fixture.last('finish_quiz').duration_seconds < 60, 'academic duration excludes five minutes spent on optional video card');
    await test.verifyAndClose(`${device.name} reports`);
  } catch (error) { await test.context.close(); throw error; }
}

async function orderedSequence(browser, device) {
  const secondId = '11111111-1111-4111-8111-111111111114';
  const first = videoFixture({ position: 1, language: 'ar', title: 'الدرس الأول — علم بلادي' });
  const second = videoFixture({ id: secondId, position: 2, video_ref: 'qaVideo0002', language: 'ar', title: 'الدرس الثاني — المجرد والمزيد' });
  const sequence = { ...clone(first), videos: [first, second] };
  const test = await setup(browser, device, { video: sequence, language: 'ar' });
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.flh-video-sequence-item').count(), 2, 'ordered sequence exposes one lesson control per video');
    assert.equal(await page.locator('.flh-video-sequence-item').nth(0).getAttribute('aria-current'), 'true');
    assert.match(await page.locator('#flhVideoLesson h3').innerText(), /علم بلادي/);
    await page.waitForFunction(() => window.__qaVideoProvider.instances.length === 1);
    await page.locator('.flh-video-sequence-item').nth(1).click();
    await page.waitForFunction(() => window.__qaVideoProvider.instances.length === 2);
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.destroyed), 1, 'switching lesson disposes the previous player');
    assert.equal(await page.locator('.flh-video-sequence-item').nth(1).getAttribute('aria-current'), 'true');
    assert.match(await page.locator('#flhVideoLesson h3').innerText(), /المجرد والمزيد/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'ordered video navigation has no horizontal overflow');
    await page.locator('#flhVideoReport').selectOption('watched_full');
    const saved = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    assert.equal((await saved).status(), 200);
    await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
    assert.equal(fixture.video.videos[1].self_report, 'watched_full', 'report saves only for the active lesson');
    assert.equal(fixture.video.videos[0].self_report, 'not_reported', 'other lesson report remains independent');
    await page.locator('.flh-video-sequence-item').nth(0).click();
    assert.equal(await page.locator('#flhVideoReport').inputValue(), 'not_reported', 'switching restores each lesson self-report state');
    await page.locator('#flhVideoStart').click();
    await questionReady(page);
    assert.equal(await page.locator('#flhOptionalVideo, #flhVideoFrame').count(), 0, 'starting practice removes the whole sequence');
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.instances.every(player => player.destroyed)), true, 'starting practice disposes every created player');
    await test.verifyAndClose(`${device.name} ordered video sequence`);
  } catch (error) { await test.context.close(); throw error; }
}

async function stalePlayerInitialization(browser, device) {
  const secondId = '11111111-1111-4111-8111-111111111114';
  const first = videoFixture({ position: 1, language: 'ar', title: 'الدرس الأول — علم بلادي' });
  const second = videoFixture({ id: secondId, position: 2, video_ref: 'qaVideo0002', language: 'ar', title: 'الدرس الثاني — المجرد والمزيد' });
  const sequence = { ...clone(first), videos: [first, second] };
  const test = await setup(browser, device, { video: sequence, language: 'ar', providerMode: 'api-delay' });
  const { page } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.instances.length), 0, 'delayed provider keeps first player initialization pending');
    await page.locator('.flh-video-sequence-item').nth(1).click();
    assert.match(await page.locator('#flhVideoLesson h3').innerText(), /المجرد والمزيد/);
    await page.waitForFunction(() => window.__qaVideoProvider.instances.length >= 1);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.instances.length), 1, 'stale initialization cannot create a second controller on the active iframe');
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.destroyed), 0, 'stale initialization is rejected before creating a player');
    assert.equal(await page.locator('#flhVideoFallback').isHidden(), true, 'stale callback cannot hide the active lesson');
    assert.equal(await page.locator('.flh-video-sequence-item').nth(1).getAttribute('aria-current'), 'true');
    await test.verifyAndClose(`${device.name} stale player initialization`);
  } catch (error) { await test.context.close(); throw error; }
}

async function skipWithoutReport(browser, device) {
  const test = await setup(browser, device, { providerMode: 'pending', video: videoFixture({ language: 'ar', title: 'شرح الأعداد الصحيحة', made_for_kids: true }), language: 'ar' });
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    await layout(page, 'ar', `${device.name} Arabic MadeForKids`);
    await screenshot(page, `optional-video-${device.name}-rtl`);
    assert.equal(await page.locator('#flhVideoReport').inputValue(), 'not_reported');
    await page.locator('#flhVideoReport').selectOption('watched_full');
    assert.equal(fixture.count('save_video_report'), 0, 'an unsaved self-report selection creates no evidence');
    await page.locator('#flhVideoStart').click();
    await questionReady(page);
    assert.equal(fixture.count('save_video_report'), 0, 'skip leaves report absent and academic rewards unchanged');
    await test.verifyAndClose(`${device.name} immediate skip`);
  } catch (error) { await test.context.close(); throw error; }
}

async function resumeAndRetry(browser, device) {
  const test = await setup(browser, device, { resumed: true, video: videoFixture({ self_report: 'watched_part', report_revision: 3 }) });
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#flhVideoReport').inputValue(), 'watched_part', 'resume restores persisted self-report');
    await page.locator('#flhVideoReport').selectOption('watched_full');
    fixture.fail('after');
    const lost = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    assert.equal((await lost).status(), 500);
    await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
    assert.equal(await page.locator('#flhVideoStart').isEnabled(), true, 'report error never blocks practice');
    const first = clone(fixture.last('save_video_report'));
    const retry = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    assert.equal((await retry).status(), 200);
    await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
    assert.equal(fixture.last('save_video_report').request_id, first.request_id, 'ambiguous response retry uses same idempotency key');
    assert.equal(fixture.last('save_video_report').expected_revision, first.expected_revision);
    assert.equal(fixture.video.report_revision, 4, 'commit-then-error retry creates one evidence edit');
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#flhVideoReport').inputValue(), 'watched_full', 'new resumed card reads server state');
    fixture.video.self_report = 'watched_part';
    fixture.video.report_revision = 5; // A separate synthetic session has edited the report.
    fixture.fail('before', 409, 'REPORT_CONFLICT');
    await page.locator('#flhVideoReport').selectOption('not_watched');
    const conflict = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    assert.equal((await conflict).status(), 409);
    await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
    assert.equal(await page.locator('#flhVideoStart').isEnabled(), true);
    assert.match(await page.locator('#flhVideoReportStatus').innerText(), /جلسة أخرى/, 'conflict is understandable without technical details');
    const stale = clone(fixture.last('save_video_report'));
    const reconciled = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    assert.equal((await reconciled).status(), 200);
    await page.waitForFunction(() => !document.getElementById('flhVideoSave')?.disabled);
    assert.equal(fixture.last('save_video_report').expected_revision, 5, 'conflict retry uses authoritative current revision');
    assert.notEqual(fixture.last('save_video_report').request_id, stale.request_id, 'reconciled edit is a new command');
    assert.equal(fixture.video.self_report, 'not_watched', 'explicit user choice survives conflict');
    assert.equal(fixture.video.report_revision, 6);
    await page.locator('#flhVideoStart').click();
    await questionReady(page);
    const draft = page.waitForResponse(response => response.url().endsWith('/learning-api') && response.request().postDataJSON()?.action === 'save_draft');
    await page.locator('.flh-learn-answer').first().click();
    await draft;
    await start(page);
    await questionReady(page);
    assert.equal(await page.locator('#flhOptionalVideo').count(), 0, 'progressed Learning resume goes straight to saved question');
    assert.equal(await page.locator('.flh-learn-answer.selected').getAttribute('data-pos'), '1', 'resume retains answer draft');
    await test.verifyAndClose(`${device.name} report resume/retry`);
  } catch (error) { await test.context.close(); throw error; }
}

async function typedDraftResumeSkipsIntroVideo(browser, device) {
  const test = await setup(browser, device, {
    resumed: true,
    typedDraft: '2,5',
    video: videoFixture({ only_before_first_question: true }),
  });
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhTypedResponse').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#flhOptionalVideo').count(), 0, 'restored typed draft counts as Learning progress and skips the intro video');
    assert.equal(await page.locator('#flhTypedResponse').inputValue(), '2,5', 'typed draft is restored into the active response control');
    const typedDirection=await page.locator('#flhTypedResponse').evaluate(node=>({dir:node.getAttribute('dir'),unicodeBidi:getComputedStyle(node).unicodeBidi}));
    assert.equal(typedDirection.dir,'ltr','typed math response must remain LTR inside the RTL shell');
    assert.match(typedDirection.unicodeBidi,/isolate/i,'typed math response must keep bidi isolation');
    assert.equal(await page.locator('.flh-resume-note').count(), 1, 'typed draft resume is visibly identified as resumed Learning');
    await page.locator('#flhTypedResponse').fill('');
    const cleared=page.waitForResponse(response=>response.url().endsWith('/learning-api')&&response.request().postDataJSON()?.action==='clear_response_draft');
    await page.locator('#flhTypedResponse').blur();
    await cleared;
    assert.equal(fixture.count('clear_response_draft'),1,'deleting a restored typed draft must persist a server-side clear');
    assert.equal(fixture.row.draft_response,null,'server fixture no longer retains the deleted typed draft');
    assert.equal(fixture.count('save_video_report'), 0, 'resuming a typed draft creates no video evidence');
    assert.equal(test.providerRequests.length, 0, 'resuming a typed draft does not initialize the video provider');
    await test.verifyAndClose(`${device.name} typed draft resume`);
  } catch (error) { await test.context.close(); throw error; }
}

async function reportPendingDoesNotGate(browser, device) {
  const test = await setup(browser, device);
  const { page, fixture } = test;
  try {
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    fixture.delay();
    await page.locator('#flhVideoReport').selectOption('watched_part');
    const request = page.waitForRequest(request => request.url().endsWith('/learning-api') && request.postDataJSON()?.action === 'save_video_report');
    const response = reportResponse(page);
    await page.locator('#flhVideoSave').click();
    await request;
    assert.equal(await page.locator('#flhVideoSave').isDisabled(), true, 'pending report prevents duplicate Save');
    assert.equal(await page.locator('#flhVideoStart').isEnabled(), true, 'pending report leaves Start usable');
    await page.locator('#flhVideoStart').click();
    await questionReady(page);
    fixture.release();
    await (await response).finished();
    assert.equal(await page.locator('#flhOptionalVideo, #flhVideoFrame').count(), 0, 'late report response cannot restore video or replace question');
    assert.equal(fixture.count('save_video_report'), 1);
    await test.verifyAndClose(`${device.name} pending optional report`);
  } catch (error) { fixture.release(); await test.context.close(); throw error; }
}

async function priorInteractionResume(browser, device) {
  const test = await setup(browser, device, { resumed: true, video: videoFixture({ only_before_first_question: false }) });
  const { page, fixture } = test;
  try {
    await start(page);
    await questionReady(page);
    assert.equal(await page.locator('#flhOptionalVideo').count(), 0, 'server-recorded prior answer skips introductory card even when current draft/hint is empty');
    assert.equal(fixture.count('save_video_report'), 0);
    assert.equal(test.providerRequests.length, 0);
    await test.verifyAndClose(`${device.name} prior-interaction resume`);
  } catch (error) { await test.context.close(); throw error; }
}

// FLH-036: expired/pruned metadata never hides parent-approved YouTube references.
async function persistentVideoWithoutProviderCache(browser, device) {
  for (const scenario of [
    {name:'status-expired',video:videoFixture({verification_expires_at:'2000-01-01T00:00:00Z',learning_outcomes:['Compare equal parts']})},
    {name:'status-pruned',video:videoFixture({made_for_kids:null,verification_expires_at:null,learning_outcomes:['Compare equal parts']})},
  ]) {
    const test=await setup(browser,device,scenario);
    const {page,fixture}=test;
    try {
      await start(page);
      await page.locator('#flhOptionalVideo').waitFor({state:'visible'});
      await page.waitForFunction(()=>window.__qaVideoProvider.instances.length===1);
      assert.equal(await page.locator('#flhVideoFrame').count(),1,'video embed exists even when provider metadata is stale/pruned');
      assert.equal(await page.locator('#flhVideoFallback').isHidden(),true,'no fake expiry message on valid video reference');
      assert.equal(await page.locator('.flh-video-outcomes').count(),1,'authored learning outcomes remain visible');
      assert.equal(fixture.count('refresh_optional_video'),0,'opening a video makes no provider revalidation calls');
      assert.equal(fixture.count('start_quiz'),1,'normal learning start preserves the assigned video');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
      await page.locator('#flhVideoStart').click();
      await questionReady(page);
      await test.verifyAndClose(`${device.name} persistent video ${scenario.name}`);
    }catch(error){await test.context.close();throw error;}
  }
}

async function failureScenarios(browser, device) {
  for (const scenario of [
    { name: 'no-video', video: null },
    { name: 'status-unavailable', video: videoFixture({ availability: 'unavailable', learning_outcomes: ['Compare equal parts'] }) },
    { name: 'provider-error', providerMode: 'error' },
    { name: 'synchronous-provider-error', providerMode: 'sync-error' },
    { name: 'network-error', providerMode: 'network-error' },
    { name: 'learner-fallback' },
  ]) {
    const test = await setup(browser, device, scenario);
    const { page, fixture } = test;
    try {
      await start(page);
      if (scenario.video === null) {
        await questionReady(page);
        assert.equal(await page.locator('#flhOptionalVideo').count(), 0, 'no attachment preserves original immediate Learning start');
        assert.equal(test.providerRequests.length, 0, 'no video requires no provider requests');
      } else {
        await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
        if (scenario.name === 'learner-fallback') await page.locator('#flhVideoUnavailable').click();
        await page.locator('#flhVideoFallback').waitFor({ state: 'visible' });
        if (scenario.name === 'synchronous-provider-error') {
          assert.equal(await page.evaluate(() => window.__qaVideoProvider.instances.length), 1, 'synchronous failure occurs during construction');
          assert.equal(await page.evaluate(() => window.__qaVideoProvider.destroyed), 1, 'constructor failure disposes the returned provider instance');
          assert.equal(await page.locator('#flhVideoFrame').count(), 0, 'synchronous failure removes playback frame');
        }
        if (['status-unavailable'].includes(scenario.name)) {
          assert.equal(await page.locator('.flh-video-outcomes').count(),0,'Outcomes are not shown for a video whose required provider status is unavailable');
          assert.equal(await page.locator('#flhVideoFrame').count(), 0, 'invalid required status cannot start an embed');
          assert.equal(test.providerRequests.length, 0, 'invalid required status cannot initiate provider requests');
        }
        assert.ok((await page.locator('#flhVideoFallback').innerText()).trim(), 'failure has clear learner message');
        assert.doesNotMatch(await page.locator('#flhVideoFallback').innerText(), /stack|VIDEO_|TypeError|request_id/i, 'no technical details in learner fallback');
        assert.equal(await page.locator('#flhVideoStart').isEnabled(), true);
        if (device.name === 'mobile' && scenario.name === 'provider-error') await screenshot(page, 'optional-video-mobile-provider-fallback');
        await page.locator('#flhVideoStart').click();
        await questionReady(page);
      }
      assert.equal(fixture.count('save_video_report'), 0, 'failure is not a viewing report');
      await test.verifyAndClose(`${device.name} ${scenario.name}`);
    } catch (error) { await test.context.close(); throw error; }
  }
}

async function directPreviewDeepLink(browser, device) {
  const secondId = '11111111-1111-4111-8111-111111111114';
  const thirdId = '11111111-1111-4111-8111-111111111116';
  const fourthId = '11111111-1111-4111-8111-111111111117';
  const first = videoFixture({ position: 1, language: 'ar', title: 'الدرس الأول — علم بلادي', only_before_first_question: false });
  const second = videoFixture({ id: secondId, position: 2, video_ref: 'qaVideo0002', language: 'ar', title: 'الدرس الثاني — المجرد والمزيد', only_before_first_question: false });
  const third = videoFixture({ id: thirdId, position: 3, video_ref: 'qaVideo0003', language: 'ar', title: 'الدرس الثالث — التعاون', only_before_first_question: false });
  const fourth = videoFixture({ id: fourthId, position: 4, video_ref: 'qaVideo0004', language: 'ar', title: 'الدرس الرابع — الفعل الصحيح والمعتل', only_before_first_question: false });
  const sequence = { ...clone(first), videos: [first, second, third, fourth] };
  const test = await setup(browser, device, {
    video: sequence,
    language: 'ar',
    resumed: true,
    progressed: true,
    initialPath: '?quiz=qa-video&mode=learning&learner=test&videos=1#student',
  });
  const { page, fixture } = test;
  try {
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    assert.equal(fixture.count('preview_videos'), 1, 'deep link uses read-only preview action');
    assert.equal(fixture.count('start_quiz'), 0, 'opening preview does not start or resume Learning yet');
    assert.equal(fixture.count('save_video_report'), 0, 'read-only preview creates no viewing report');
    assert.equal(await page.locator('.flh-video-sequence-item').count(), 4, 'deep link exposes all four ordered lessons');
    assert.equal(await page.locator('#flhVideoReport').count(), 0, 'preview has no report controls without an attempt snapshot');
    assert.equal((await page.locator('#flhVideoStart').innerText()).trim(), 'متابعة التدريب');
    assert.match(await page.locator('#flhVideoLesson h3').innerText(), /علم بلادي/);
    await page.locator('.flh-video-sequence-item').nth(3).click();
    assert.match(await page.locator('#flhVideoLesson h3').innerText(), /الفعل الصحيح والمعتل/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'deep-link preview has no horizontal overflow');
    assert.equal(fixture.row.draft_option_position, 1, 'opening preview preserves the existing draft answer');
    assert.equal(new URL(page.url()).searchParams.has('videos'), false, 'deep-link routing cleans preview parameters after launch');

    await page.locator('#flhVideoStart').click();
    await questionReady(page);
    assert.equal(fixture.count('start_quiz'), 1, 'continue resumes Learning only after learner action');
    assert.equal(fixture.row.draft_option_position, 1, 'continue preserves the existing saved draft');
    assert.equal(await page.locator('.flh-resume-note').count(), 1, 'continued Learning is visibly resumed');
    assert.equal(await page.locator('.flh-learn-answer.selected').count(), 1, 'saved answer selection is restored');
    assert.equal(fixture.count('save_video_report'), 0, 'preview and continue never create self-report evidence');
    await test.verifyAndClose(`${device.name} direct video preview deep link`);
  } catch (error) { await test.context.close(); throw error; }
}

async function examIndependence(browser, device) {
  const test = await setup(browser, device, { providerMode: 'pending' });
  const { page, fixture } = test;
  try {
    await page.evaluate(() => window.FLH.startExamQuiz('qa-video'));
    await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible' });
    assert.equal(fixture.count('start_quiz'), 0, 'direct Exam start never requests Learning/video');
    assert.equal(fixture.count('save_video_report'), 0);
    assert.equal(test.providerRequests.length, 0, 'Exam requires no provider access');
    assert.equal(await page.locator('#flhOptionalVideo, #flhVideoFrame').count(), 0, 'video is absent in Exam');
    assert.equal(await page.locator('.flh-hint-card, .flh-explanation, .exam-review').count(), 0, 'in-progress Exam reveals no Learning help/answer review');
    await start(page);
    await page.locator('#flhOptionalVideo').waitFor({ state: 'visible' });
    await page.evaluate(() => window.FLH.startExamQuiz('qa-video'));
    await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#flhOptionalVideo, #flhVideoFrame').count(), 0, 'switching to Exam removes optional video surface');
    assert.equal(await page.evaluate(() => window.__qaVideoProvider.instances.every(player => player.destroyed)), true, 'switching to Exam disposes any provider instance');
    assert.equal(fixture.count('save_video_report'), 0, 'switching mode creates no automatic viewing evidence');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Exam still has no horizontal overflow');
    await test.verifyAndClose(`${device.name} Exam independence`);
  } catch (error) { await test.context.close(); throw error; }
}


async function lessonAccessStages(browser,device){
  const test=await setup(browser,device,{progressed:true,resumed:true,language:'ar'});
  const {page,fixture}=test;
  try{
    await start(page);await questionReady(page);
    await page.locator('#flhHelp').click();await page.locator('.flh-hint-card').waitFor();
    await page.evaluate(()=>{window.__qaQuestionNode=document.querySelector('.flh-touch-quiz');});
    const academic=()=>fixture.calls.filter(x=>['start_quiz','answer','finish_quiz','save_draft','request_hint'].includes(x.action)).length;
    const before=academic();
    await page.locator('#flhLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoFrame').waitFor();
    assert.equal(fixture.last('preview_videos').attempt_id,ATTEMPT_ID,'Learning preview carries exact owned attempt context');
    assert.equal(await page.locator('.flh-video-dialog').evaluate(el=>el.matches(':modal')),true,'Native modal makes the underlying academic screen inert');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile/desktop overlay has no overflow');
    assert.ok(await page.locator('#flhVideoFrame').evaluate(el=>el.getBoundingClientRect().width>=200&&el.getBoundingClientRect().height>=200),'official player minimum retained');
    await screenshot(page,'lesson-video-'+device.name+'-learning');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.querySelector('.flh-touch-quiz')===window.__qaQuestionNode),true,'Returning preserves the exact question DOM');
    assert.equal(await page.locator('.flh-learn-answer.selected').getAttribute('data-pos'),'1');
    assert.match(await page.locator('.flh-hint-card').innerText(),/خط الأعداد/);
    assert.equal(fixture.row.hint_level_requested,1);assert.equal(academic(),before,'Opening/closing makes zero academic requests');
    assert.equal(await page.locator('#flhLessonVideo').evaluate(el=>el===document.activeElement),true,'Escape restores focus to video action');
    await page.locator('#flhConfirmAnswer').click();await page.locator('#flhLearnNext').waitFor();
    await page.locator('#flhLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    await page.locator('#flhLearnNext').click();await page.locator('#learnHome').waitFor();
    const finished=academic();
    await page.locator('#flhLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    assert.equal(academic(),finished,'Learning result video never finishes again or starts a retake');
    assert.equal(fixture.count('finish_quiz'),1);await page.locator('#learnHome').waitFor();
    await screenshot(page,'lesson-video-'+device.name+'-learning-result');
    await page.evaluate(()=>window.FLH.startExamQuiz('qa-video'));await page.locator('.exam-v3-answer').first().waitFor();
    assert.equal(await page.getByRole('button',{name:/فيديو الدرس/}).count(),0,'Active Exam has no video control');
    await page.locator('.exam-v3-answer').first().click();await page.locator('#examSubmit').click();await page.locator('#examHome').waitFor();
    await page.locator('#examLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    assert.equal(fixture.count('submit_exam'),1,'Submitted Exam review is not submitted again');
    assert.equal(fixture.count('start_exam'),1,'Submitted Exam video does not start another Exam');
    await screenshot(page,'lesson-video-'+device.name+'-exam-result');
    await test.verifyAndClose(device.name+' lesson access stages');
  }catch(error){await test.context.close();throw error;}
}

async function lessonTypedDraft(browser,device){
  const test=await setup(browser,device,{typedDraft:'2,5',resumed:true});const {page,fixture}=test;
  try{
    await start(page);await page.locator('#flhTypedResponse').fill('19 - (-7)');
    await page.evaluate(()=>{window.__qaTypedNode=document.getElementById('flhTypedResponse');});
    await page.locator('#flhLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    assert.equal(await page.locator('#flhTypedResponse').inputValue(),'19 - (-7)','Draft survives opening and closing');
    assert.equal(await page.evaluate(()=>document.getElementById('flhTypedResponse')===window.__qaTypedNode),true,'The input is never reconstructed');
    assert.equal(fixture.count('start_quiz'),1);assert.equal(fixture.count('answer_response'),0);assert.equal(fixture.count('finish_quiz'),0);
    await page.locator('#flhLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoFrame').waitFor();
    await page.evaluate(()=>{localStorage.removeItem('learner_session');dispatchEvent(new StorageEvent('storage',{key:'learner_session'}));});
    assert.equal(await page.locator('.flh-video-dialog').count(),0,'Session change removes the old learner player');
    await test.verifyAndClose(device.name+' lesson typed draft/session');
  }catch(error){await test.context.close();throw error;}
}

async function libraryAndHistoryVideos(browser,device){
  const j=(state,action)=>({state,primary_action:action,learning:{available:true,resumed:state==='CONTINUE_LEARNING'},exam:{available:true,resumed:false},...(state==='COMPLETE'?{result_attempt_id:ATTEMPT_ID}:{})});
  const catalog={programs:[],standalone_books:[],standalone_assessments:[
    {id:'new',slug:'qa-video',title:'نشاط جديد',journey:j('NEW','learning')},
    {id:'ongoing',slug:'qa-ongoing',title:'نشاط مستمر',journey:j('CONTINUE_LEARNING','learning')},
    {id:'complete',slug:'qa-complete',title:'نشاط مكتمل',journey:j('COMPLETE','results')},
    {id:'exam',slug:'qa-active-exam',title:'امتحان نشط',journey:{...j('START_EXAM','exam'),exam:{available:true,resumed:true}}},
  ]};
  const history={attempt:{id:ATTEMPT_ID,delivery_mode:'exam',percentage:50,wrong_count:1,submitted_at:'2026-10-30T10:00:00Z',context:{quiz:{slug:'qa-video',title:'نتيجة الاختبار'}}},review:[{prompt:'19 - (-7)',is_correct:false,selected_text_fallback:'-26',explanation:'راجع خط الأعداد'}]};
  const test=await setup(browser,device,{catalog,history});const {page,fixture}=test;
  try{
    await page.locator('[data-student-library] [data-lesson-video="qa-video"]').first().waitFor();
    for(const slug of ['qa-video','qa-ongoing','qa-complete'])assert.ok(await page.locator('[data-lesson-video="'+slug+'"]').count()>0,'Video offered for '+slug);
    assert.equal(await page.locator('[data-lesson-video="qa-active-exam"]').count(),0,'Authoritative active Exam hides library button');
    await page.locator('[data-lesson-video="qa-video"]').first().click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    assert.equal(fixture.count('start_quiz'),0,'Library video does not start Learning');
    await page.evaluate(id=>window.FLH.openAttemptHistoryAttempt(id),ATTEMPT_ID);await page.locator('#ahLessonVideo').waitFor();
    await page.locator('#ahLessonVideo').click();await page.locator('.flh-video-dialog #flhVideoStart').click();
    assert.equal(fixture.last('preview_videos').attempt_id,ATTEMPT_ID,'Historical review passes exact submitted attempt');
    assert.equal(fixture.count('start_exam')+fixture.count('start_quiz'),0,'History video cannot create attempts');
    assert.match(await page.locator('.flh-history-review-list').innerText(),/خط الأعداد/,'Mistake review survives video');
    await screenshot(page,'lesson-video-'+device.name+'-history');
    await test.verifyAndClose(device.name+' library and history');
  }catch(error){await test.context.close();throw error;}
}

async function eligibleResume(browser,device){
  const store=new Map();
  const test=await setup(browser,device,{progressStore:store,providerMode:'resume'});
  const {page,fixture}=test;
  const open=p=>p.evaluate(()=>window.FLH.openLearningVideos('qa-video',{inPlace:true}));
  const fire=(p,time,state=2)=>p.evaluate(({time,state})=>{window.__qaVideoProvider.time=time;window.__qaVideoProvider.fire('onStateChange',state);},{time,state});
  const waitSave=(p)=>p.waitForResponse(r=>r.url().endsWith('/learning-api')&&r.request().postDataJSON()?.action==='save_video_progress');
  const enable=async p=>{await p.locator('[data-progress-enable]').click();await p.waitForFunction(()=>window.__qaVideoProvider.instances.at(-1)?.options.events.onStateChange&&window.__qaVideoProvider.seek!==undefined);};
  let other;
  try{
    await open(page);await page.locator('[data-progress-enable]').waitFor();
    assert.equal(await page.locator('#flhVideoResume').getAttribute('data-flh-private'),'','resume timing excluded from replay capture');
    assert.match(await page.locator('#flhVideoResume').getAttribute('class'),/ph-no-capture/,'resume controls excluded from autocapture');
    assert.equal(store.size,0,'opening unstarted video creates no timing row');
    assert.deepEqual(await page.evaluate(()=>window.__qaVideoProvider.metrics),[],'no timing read before opt-in');
    await enable(page);await fire(page,83,1);
    let saved=waitSave(page);await fire(page,83);await saved;
    await page.locator('[data-progress-clear]').waitFor();
    assert.equal(store.get('qaVideo0001').position_seconds,83);
    if(device.name==='mobile'){
      saved=waitSave(page);await fire(page,84,1);await saved;
      assert.equal(store.get('qaVideo0001').position_seconds,84,'periodic timer saves during continued playback');
    }
    // A lost response must retry the same mutation rather than overwrite a new revision.
    fixture.fail('after',500,'VIDEO_PROGRESS_UNAVAILABLE');
    const revisionBeforeFailure=store.get('qaVideo0001').revision;
    saved=waitSave(page);await fire(page,88);await saved;
    await page.getByText('تعذر التأكد من الحفظ.',{exact:false}).waitFor();
    const lost=fixture.last('save_video_progress');saved=waitSave(page);await fire(page,90);await saved;
    assert.equal(fixture.last('save_video_progress').request_id,lost.request_id,'uncertain save retried idempotently');
    assert.equal(store.get('qaVideo0001').revision,revisionBeforeFailure+1);
    await page.locator('#flhVideoStart').click();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof window.FLH?.openLearningVideos==='function');
    await open(page);await page.getByRole('button',{name:'متابعة من الدقيقة السابقة'}).waitFor();
    await screenshot(page,'lesson-video-'+device.name+'-resume-choice');
    const before=store.get('qaVideo0001').position_seconds;
    await enable(page);assert.equal(await page.evaluate(()=>window.__qaVideoProvider.seek),before,'reload and re-login restore server marker');
    other=await setup(browser,device,{progressStore:store,providerMode:'resume'});
    await open(other.page);await enable(other.page);
    assert.equal(await other.page.evaluate(()=>window.__qaVideoProvider.seek),before,'another device restores same marker');
    await fire(page,101,1);saved=waitSave(page);await fire(page,101);await saved;
    await fire(other.page,150,1);saved=waitSave(other.page);await fire(other.page,150);await saved;
    await other.page.getByText('تغيّر الحفظ أو إتاحة الفيديو.',{exact:false}).waitFor();
    assert.equal(store.get('qaVideo0001').position_seconds,101,'stale device cannot overwrite current position');
    await other.page.locator('[data-progress-reload]').click();await enable(other.page);
    assert.equal(await other.page.evaluate(()=>window.__qaVideoProvider.seek),101);
    await fire(other.page,180,1);saved=waitSave(other.page);await fire(other.page,180,0);await saved;
    assert.equal(store.get('qaVideo0001').ended,true);
    await other.page.locator('#flhVideoStart').click();await open(other.page);
    await other.page.getByText('وصل التشغيل سابقًا إلى النهاية.',{exact:false}).waitFor();
    await other.page.locator('[data-progress-restart]').click();
    await other.page.waitForFunction(()=>window.__qaVideoProvider.seek===0);
    assert.equal(store.get('qaVideo0001').has_progress,false,'restart erases previous marker');
    await fire(other.page,24,1);saved=waitSave(other.page);await fire(other.page,24);await saved;
    await other.page.locator('[data-progress-clear]').click();
    await other.page.locator('[data-progress-enable]').waitFor();
    assert.equal(store.get('qaVideo0001').has_progress,false,'learner can erase marker and disable saving');
    store.set('qaVideo0001',{...store.get('qaVideo0001'),eligible:false});
    const instancesBefore=await other.page.evaluate(()=>window.__qaVideoProvider.instances.length);
    await other.page.locator('[data-progress-enable]').click();
    await other.page.getByText('المشاهدة متاحة دون حفظ موضع التشغيل لهذا الفيديو.',{exact:true}).waitFor();
    assert.equal(await other.page.evaluate(()=>window.__qaVideoProvider.instances.length),instancesBefore,'opt-in rechecks server eligibility before tracking');
    assert.equal(fixture.count('start_quiz')+fixture.count('answer')+fixture.count('finish_quiz')+fixture.count('start_exam'),0,'resume has no academic mutations');
    await screenshot(other.page,'lesson-video-'+device.name+'-resume-cleared');
    await other.verifyAndClose(device.name+' resume other session');other=null;
    await test.verifyAndClose(device.name+' resume');
  }catch(error){await other?.context.close();await test.context.close();throw error;}
}

const browser = await launchMockQaBrowser(chromium,APP_URL);
try {
  for (const device of [{ name: 'mobile', viewport: { width: 390, height: 844 } }, { name: 'desktop', viewport: { width: 1365, height: 900 } }]) {
    await eligibleResume(browser,device);
    await lessonAccessStages(browser,device);
    await lessonTypedDraft(browser,device);
    await libraryAndHistoryVideos(browser,device);
    await authoredOutcomes(browser, device);
    await previewThenFrozenOutcomes(browser, device);
    await explicitReports(browser, device);
    await orderedSequence(browser, device);
    await stalePlayerInitialization(browser, device);
    await skipWithoutReport(browser, device);
    await resumeAndRetry(browser, device);
    await typedDraftResumeSkipsIntroVideo(browser, device);
    await reportPendingDoesNotGate(browser, device);
    await priorInteractionResume(browser, device);
    await directPreviewDeepLink(browser, device);
    await persistentVideoWithoutProviderCache(browser, device);
    await failureScenarios(browser, device);
    await examIndependence(browser, device);
    console.log(`Optional-video real-runtime regression PASS (${device.name}; synthetic Testing data; no live provider/device claim).`);
  }
  fs.writeFileSync(`${OUTPUT_DIR}/optional-video-outcomes-manifest.json`,JSON.stringify({feature_id:'FLH-FEAT-2026-041',spec_version:'1.1',drive_revision_id:'3',outcomes_feature_id:'FLH-FEAT-2026-024',outcomes_drive_revision_id:'2',child_feature_id:'FLH-FEAT-2026-022',child_spec_version:'1.1',child_drive_revision_id:'3',source:'guarded isolated mocked Testing runtime; no live provider/device claim',head_sha:process.env.FLH_QA_HEAD_SHA||process.env.GITHUB_SHA||null,run_id:process.env.GITHUB_RUN_ID||null,retention_days:7,files:screenshotFiles},null,2));
} finally { await browser.close(); }
