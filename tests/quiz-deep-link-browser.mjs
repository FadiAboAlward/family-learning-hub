import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { launchMockQaBrowser } from './qa-isolation.mjs';

// FLH-FEAT-2026-040 v1.0 and FLH-FEAT-2026-043 v1.0: email deep-link flow, browser-backed + synthetic APIs.
// FLH-043 DRIVE_REVISION_ID: AHj4eMR2Zhci4BO57YU842wtzoTMGiolPp9Jmb7vkb_ZSyV7aqQ_31xEcP2trM6aN_mMaVclTwoEZ7uAZvjiaRQzRODLRVtRtxp5agOcBRQ
// DRIVE_REVISION_ID: AHj4eMRkoQupak-TxzQkdZpcV53G0sdV5wFJPDHYuL1h-iuZAvfIZQ8qU1VtWImGMd7y5W0xJ_93OB6ziaJqxCz5k3x_sLuAwunEmwWFDOA
// All API calls are fulfilled locally; the shared QA isolation guard blocks Production.
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const QUIZ = 'qa-email-direct-route';
const ID = '10000000-0000-4000-8000-000000000001';
const profile = (slug = 'mohammad') => ({
  learner: { id: ID, slug, display_name: slug === 'aya' ? 'آية' : 'محمد', grade_level: 7, is_test: slug === 'test', avatar_emoji: '🧪' },
  gamification: { xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0, badges: [], rewards: [] },
});
const learnerChoices = ['aya', 'mohammad'].map(slug => profile(slug).learner);
const question = { id: ID, question_code: 'QA-EMAIL-01', question_type: 'single_choice', prompt_language: 'en',
  prompt: 'Select the correct practice option.', options: [{ position: 1, content: 'Yes' }, { position: 2, content: 'No' }], assets: [] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const browser = await launchMockQaBrowser(chromium, APP_URL);

async function check({ device, mode, initialLearner = null, expectedStarts = 1 }) {
  const context = await browser.newContext({ viewport: device.viewport });
  const page = await context.newPage(), calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (initialLearner) await context.addInitScript(slug => localStorage.setItem('learner_session', 'synthetic-' + slug), initialLearner);
  await context.route('**/functions/v1/*', async route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = route.request().postDataJSON() || {};
    calls.push({ endpoint, action: body.action, quiz_slug: body.quiz_slug });
    if (endpoint === 'family-api') {
      if (body.action === 'learner_choices') {
        await new Promise(resolve => setTimeout(resolve, 90));
        return json(route, { learners: learnerChoices });
      }
      if (body.action === 'student_login') {
        assert.equal(body.slug, 'mohammad');
        return json(route, { session: 'synthetic-mohammad', profile: profile('mohammad') });
      }
      if (body.action === 'student_profile') return json(route, profile(initialLearner || 'mohammad'));
      return json(route, { ok: true });
    }
    if (endpoint === 'learning-api') {
      assert.equal(body.action, 'start_quiz');
      assert.equal(body.quiz_slug, QUIZ);
      return json(route, { attempt_id: ID, resumed: false, quiz: { slug: QUIZ, title: 'Email Learning target' },
        optional_video: null, queue: [{ question_id: ID, source_role: 'core', status: 'active',
          draft_option_position: null, hint_level_requested: 0, question }] });
    }
    if (endpoint === 'exam-v2-api') {
      if (body.action === 'warmup') return json(route, { ok: true });
      assert.equal(body.action, 'start_exam');
      assert.equal(body.quiz_slug, QUIZ);
      return json(route, { attempt_id: ID, resumed: false, quiz: { slug: QUIZ, title: 'Email Exam target' },
        questions: [{ question_id: ID, question, saved_response: null, is_flagged: false }] });
    }
    if (endpoint === 'student-library-api') return json(route, { programs: [], standalone_books: [], standalone_assessments: [] });
    if (endpoint === 'question-reference-api') return json(route, { codes: {} });
    return json(route, { ok: true });
  });
  try {
    const link = APP_URL + 'index.html?quiz=' + QUIZ + '&mode=' + mode + '&learner=mohammad';
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    if (!initialLearner) {
      const pin = page.locator('#studentPin');
      await pin.waitFor({ timeout: 15000 });
      assert.equal(await page.locator('[data-dynamic-learner="mohammad"]').count(), 1, 'async learner choice mounted');
      assert.equal(await pin.isVisible(), true, 'email correctly preselects Mohammad and opens PIN entry');
      assert.equal(calls.filter(c => c.action === 'start_quiz' || c.action === 'start_exam').length, 0, 'no start before login');
      await pin.fill('12345678'); // Synthetic only: never use an actual PIN.
      await page.locator('#studentLoginBtn').click();
    }
    if (expectedStarts) {
      await page.getByText(mode === 'learning' ? 'Email Learning target' : 'Email Exam target', { exact: false }).first().waitFor({ timeout: 15000 });
      await page.waitForFunction(() => !location.searchParams && !location.search.includes('quiz='), null, { timeout: 10000 });
      assert.equal(await page.locator('.question').count() > 0, true, 'question is rendered, not library');
      assert.equal(await page.evaluate(() => location.search.includes('quiz=')), false, 'URL cleaned after actual start');
    } else {
      await page.getByText('آية', { exact: false }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => location.search.includes('quiz=')), true, 'wrong student cannot consume link');
    }
    const starts = calls.filter(c => c.action === (mode === 'learning' ? 'start_quiz' : 'start_exam'));
    assert.equal(starts.length, expectedStarts, 'exact quiz starts once, only for authorized learner');
    // FLH-FEAT-2026-043 v1.0 — an actual browser executes the production
    // build-check helper while an emailed route is cleaned during its fetch.
    const refreshRace = await page.evaluate(async (requestedMode) => {
      const original = new URL('index.html', location.href);
      original.searchParams.set('quiz', 'qa-email-direct-route');
      original.searchParams.set('mode', requestedMode);
      original.searchParams.set('learner', 'mohammad');
      original.hash = '#student';
      const locationLike = { href: original.href };
      const saved = new Map();
      const storage = { getItem: key => saved.get(key) || null,
        setItem: (key, value) => saved.set(key, String(value)),
        removeItem: key => saved.delete(key) };
      let resolveFetch, target = null;
      const pending = FLHAppVersion.checkNow({
        locationLike, storage,
        documentLike: { querySelector: () => ({ content: 'old-build' }),
          body: { dataset: { build: 'old-build' } } },
        fetchFn: () => new Promise(resolve => { resolveFetch = resolve; }),
        navigate: href => { target = href; }
      });
      locationLike.href = new URL('index.html#student', location.href).href;
      resolveFetch({ ok: true, text: async () => '<meta name="app-build" content="new-build">' });
      const result = await pending;
      return { status: result.status, target };
    }, mode);
    assert.equal(refreshRace.status, 'refreshing', 'stale build schedules one refresh');
    const preserved = new URL(refreshRace.target);
    assert.equal(preserved.searchParams.get('quiz'), QUIZ, 'email quiz survives build refresh');
    assert.equal(preserved.searchParams.get('mode'), mode, 'Learning/Exam mode survives build refresh');
    assert.equal(preserved.searchParams.get('learner'), 'mohammad', 'learner hint survives');
    assert.equal(preserved.searchParams.get('_flh_build'), 'new-build', 'refresh targets the latest build');
    assert.deepEqual(errors, [], 'no unexpected page errors');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
  } finally {
    await context.close();
  }
}

try {
  for (const device of [
    { name: 'mobile', viewport: { width: 390, height: 844 } },
    { name: 'desktop', viewport: { width: 1280, height: 900 } },
  ]) {
    await check({ device, mode: 'learning' });
    await check({ device, mode: 'exam' });
    await check({ device, mode: 'learning', initialLearner: 'mohammad' });
    await check({ device, mode: 'learning', initialLearner: 'aya', expectedStarts: 0 });
  }
  console.log('Email deep-link browser regression passed (mobile, desktop, login, exam, existing and mismatched sessions).');
} finally {
  await browser.close();
}
