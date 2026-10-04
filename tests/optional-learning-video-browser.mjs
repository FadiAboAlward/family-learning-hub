import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// FLH-FEAT-2026-012 / v1.1 / Drive revision 2. Real runtimes, synthetic Testing data.
// Provider rendering is intentionally mocked; live ads/navigation/tablet QA is separate.
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const OUTPUT_DIR = 'playwright-screenshots';
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

function createFixture({ video = videoFixture(), language = 'tr', resumed = false, progressed = false } = {}) {
  const calls = [];
  const reportResults = new Map();
  let failure = null;
  let delayPromise = null;
  let releaseDelay;
  let started = resumed;
  const row = {
    question_id: 'qa-optional-video-question', source_role: 'core', status: 'active',
    draft_option_position: progressed ? 1 : null, hint_level_requested: 0,
    question: { id: 'qa-optional-video-question', question_code: 'QA-OPTIONAL-VIDEO', prompt_language: language,
      prompt: language === 'ar' ? 'احسب: 19 - (-7)' : '19 - (-7) işleminin sonucu nedir?',
      options: [{ position: 1, content: '26' }, { position: 2, content: '-26' }], assets: [] },
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
      if (endpoint === 'student-library-api') return { body: { programs: [], standalone_books: [] } };
      if (endpoint === 'activity-api') return { body: { ok: true } };
      if (endpoint === 'question-reference-api') return { body: { codes: {} } };
      if (endpoint === 'exam-v2-api') {
        if (body.action === 'start_exam') return { body: { attempt_id: 'qa-video-exam', resumed: false, quiz: { slug: 'qa-video', title: 'امتحان الاختبار' }, questions: [{ ...clone(row), saved_response: null, is_flagged: false }] } };
        if (body.action === 'submit_exam') return { body: { percentage: 100, score_points: 1, max_points: 1, review: [] } };
        return { body: { ok: true } };
      }
      assert.equal(endpoint, 'learning-api', 'mock never forwards an unrecognized API to a live backend');
      if (body.action === 'preview_videos') {
        return { body: { quiz_version_id: '11111111-1111-4111-8111-111111111115', resumable_attempt_id: started ? ATTEMPT_ID : null, quiz: { slug: 'qa-video', title: 'تدريب الاختبار' }, optional_video: clone(video) } };
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
    localStorage.setItem('learner_session', 'mock-optional-video-testing-session');
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
      assert.deepEqual(tracking.metrics, [], `${label}: no player-derived metric access`);
      assert.ok(tracking.events.every(event => ['onReady', 'onError'].includes(event)), `${label}: no player-state/seek/ended tracking listeners`);
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

async function failureScenarios(browser, device) {
  for (const scenario of [
    { name: 'no-video', video: null },
    { name: 'status-unavailable', video: videoFixture({ availability: 'unavailable' }) },
    { name: 'status-expired', video: videoFixture({ verification_expires_at: '2000-01-01T00:00:00Z' }) },
    { name: 'made-for-kids-unknown', video: videoFixture({ made_for_kids: null }) },
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
        if (['status-unavailable', 'status-expired', 'made-for-kids-unknown'].includes(scenario.name)) {
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

const browser = await chromium.launch({ headless: true });
try {
  for (const device of [{ name: 'mobile', viewport: { width: 390, height: 844 } }, { name: 'desktop', viewport: { width: 1365, height: 900 } }]) {
    await explicitReports(browser, device);
    await orderedSequence(browser, device);
    await skipWithoutReport(browser, device);
    await resumeAndRetry(browser, device);
    await reportPendingDoesNotGate(browser, device);
    await priorInteractionResume(browser, device);
    await directPreviewDeepLink(browser, device);
    await failureScenarios(browser, device);
    await examIndependence(browser, device);
    console.log(`Optional-video real-runtime regression PASS (${device.name}; synthetic Testing data; no live provider/device claim).`);
  }
} finally { await browser.close(); }
