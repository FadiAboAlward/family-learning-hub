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

async function check({ device, mode, learner = 'mohammad', initialLearner = null, expectedStarts = 1, refreshAfterLaunch = false }) {
  const context = await browser.newContext({ viewport: device.viewport });
  const page = await context.newPage(), calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const navigations = [];
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  let markBuildFetchStarted, releaseBuildFetch;
  const buildFetchStarted = new Promise(resolve => { markBuildFetchStarted = resolve; });
  let buildFetchCount = 0;
  if (refreshAfterLaunch) {
    // Intercept the actual watcher request and hold its response. This is a
    // real browser navigation/reload, not an artificial locationLike object.
    await page.route('**/index.html?*', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('_flh_build_check')) {
        if (buildFetchCount++ === 0) {
          markBuildFetchStarted();
          await new Promise(resolve => {
            releaseBuildFetch = async () => {
              await route.fulfill({ status: 200, contentType: 'text/html',
                body: '<meta name="app-build" content="qa-new-build">' });
              resolve();
            };
          });
          return;
        }
        return route.fulfill({ status: 200, contentType: 'text/html',
          body: '<meta name="app-build" content="qa-new-build">' });
      }
      if (url.searchParams.get('_flh_build') === 'qa-new-build') {
        // Simulate the newer index being deployed after a stale page reloads.
        const response = await route.fetch();
        const html = await response.text();
        const oldBuild = html.match(/<meta name="app-build" content="([^"]+)"/)?.[1];
        assert.ok(oldBuild, 'served index must declare its build');
        return route.fulfill({ response, body: html.replaceAll(oldBuild, 'qa-new-build') });
      }
      return route.continue();
    });
  }
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
        assert.equal(body.slug, learner);
        return json(route, { session: 'synthetic-' + learner, profile: profile(learner) });
      }
      if (body.action === 'student_profile') return json(route, profile(initialLearner || learner));
      return json(route, { ok: true });
    }
    if (endpoint === 'learning-api') {
      assert.equal(body.action, 'start_quiz');
      assert.equal(body.quiz_slug, QUIZ);
      return json(route, { attempt_id: ID, resumed: calls.filter(c => c.action === 'start_quiz').length > 1, quiz: { slug: QUIZ, title: 'Email Learning target' },
        optional_video: null, queue: [{ question_id: ID, source_role: 'core', status: 'active',
          draft_option_position: null, hint_level_requested: 0, question }] });
    }
    if (endpoint === 'exam-v2-api') {
      if (body.action === 'warmup') return json(route, { ok: true });
      assert.equal(body.action, 'start_exam');
      assert.equal(body.quiz_slug, QUIZ);
      return json(route, { attempt_id: ID, resumed: calls.filter(c => c.action === 'start_exam').length > 1, quiz: { slug: QUIZ, title: 'Email Exam target' },
        questions: [{ question_id: ID, question, saved_response: null, is_flagged: false }] });
    }
    if (endpoint === 'student-library-api') return json(route, { programs: [], standalone_books: [], standalone_assessments: [] });
    if (endpoint === 'question-reference-api') return json(route, { codes: {} });
    return json(route, { ok: true });
  });
  try {
    const link = APP_URL + 'index.html?quiz=' + QUIZ + '&mode=' + mode + '&learner=' + learner;
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    if (!initialLearner) {
      const pin = page.locator('#studentPin');
      await pin.waitFor({ timeout: 15000 });
      assert.equal(await page.locator('[data-dynamic-learner="' + learner + '"]').count(), 1, 'requested learner choice mounted');
      assert.equal(await pin.isVisible(), true, 'email preselects the requested learner and opens PIN entry');
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
      await page.getByText(initialLearner === 'aya' ? 'آية' : 'محمد', { exact: false }).first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => location.search.includes('quiz=')), true, 'wrong student cannot consume link');
    }
    const starts = calls.filter(c => c.action === (mode === 'learning' ? 'start_quiz' : 'start_exam'));
    assert.equal(starts.length, expectedStarts, 'exact quiz starts once, only for authorized learner');
    if (refreshAfterLaunch) {
      assert.equal(expectedStarts, 1, 'refresh test must have an authorized start');
      // The first real quiz launch has cleaned the URL while the first
      // real app-build fetch remains held. Only now release the newer build.
      // Fail fast if the production watcher no longer emits the build check.
      let buildRequestTimeout;
      try {
        await Promise.race([
          buildFetchStarted,
          new Promise((_, reject) => {
            buildRequestTimeout = setTimeout(() => reject(new Error(
              'Timed out waiting for real _flh_build_check network request'
            )), 7000);
          })
        ]);
      } finally {
        clearTimeout(buildRequestTimeout);
      }
      assert.equal(await page.evaluate(() => location.search.includes('quiz=')), false);
      assert.equal(calls.filter(c => c.action === (mode === 'learning' ? 'start_quiz' : 'start_exam')).length, 1);
      assert.equal(typeof releaseBuildFetch, 'function');
      await releaseBuildFetch();
      await page.waitForFunction(() =>
        document.querySelector('meta[name="app-build"]')?.content === 'qa-new-build' &&
        !!document.querySelector('.question') && !location.search.includes('quiz='), null,
        { timeout: 20000 });
      const resumedRoutes = navigations.filter(href =>
        new URL(href).searchParams.get('_flh_build') === 'qa-new-build');
      assert.ok(resumedRoutes.length >= 1, 'production watcher must cause a real browser navigation');
      const preservedRoute = new URL(resumedRoutes[0]);
      assert.equal(preservedRoute.searchParams.get('quiz'), QUIZ, 'real reload preserves emailed quiz');
      assert.equal(preservedRoute.searchParams.get('mode'), mode, 'real reload preserves mode');
      assert.equal(preservedRoute.searchParams.get('learner'), learner, 'real reload preserves requested learner');
      assert.equal(calls.filter(c => c.action === (mode === 'learning' ? 'start_quiz' : 'start_exam')).length,
        2, 'after one real reload, the same synthetic attempt resumes once');
    }
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
    for (const learner of ['mohammad', 'aya']) {
      await check({ device, mode: 'learning', learner });
      await check({ device, mode: 'exam', learner });
      await check({ device, mode: 'learning', learner, initialLearner: learner });
      await check({ device, mode: 'learning', learner, initialLearner: learner, refreshAfterLaunch: true });
      await check({ device, mode: 'exam', learner, initialLearner: learner, refreshAfterLaunch: true });
      // Also cover first PIN login and the newer-build race in one real browser flow.
      await check({ device, mode: 'learning', learner, refreshAfterLaunch: true });
      await check({ device, mode: 'exam', learner, refreshAfterLaunch: true });
    }
    await check({ device, mode: 'learning', learner: 'mohammad', initialLearner: 'aya', expectedStarts: 0 });
    await check({ device, mode: 'learning', learner: 'aya', initialLearner: 'mohammad', expectedStarts: 0 });
  }
  console.log('Email deep-link browser regression passed (both learners, mobile/desktop, real stale-build reload, login, exam and wrong-session guards).');
} finally {
  await browser.close();
}
