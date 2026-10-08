import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchQaBackend, fetchQaOidc, installQaBrowserIsolation, qaBrowserLaunchOptions, readQaTestingConfig, verifyQaTestingBackend } from './qa-isolation.mjs';
import { fetchRunnerLocalAuth } from './qa-runner-local.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const QA_QUIZ_SLUG = 'qa-automation-core';
const QA_PROGRAM_TITLE = 'QA Automation — Testing';
const QA_BOOK_TITLE = 'QA Automation Book';
const QA_QUESTION_COUNT = 3;
const QA_BUSY_RETRIES = 20;
const QA_BUSY_RETRY_MS = 10000;

/** Request a GitHub Actions OIDC token scoped to the Family Learning Hub QA audience. */
async function githubOidcToken() {
  const config = readQaTestingConfig();
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('GitHub OIDC environment is unavailable');
  const response = await fetchQaOidc(config, url, bearer);
  if (!response.ok) throw new Error(`GitHub OIDC request failed: ${response.status}`);
  const payload = await response.json();
  if (!payload.value) throw new Error('GitHub OIDC token missing');
  return payload.value;
}

/** Call qa-auth with an explicit owned lifecycle action and optional run identifier. */
async function requestQaAuth(action, runId = null) {
  const config = readQaTestingConfig();
  const response = await fetchQaBackend(config, 'qa-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.publishableKey },
    body: JSON.stringify({
      oidc_token: await githubOidcToken(),
      action,
      ...(runId ? { run_id: runId } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

/** Acquire the owned Testing QA session, retrying while another valid lease is active. */
async function prepareQaRun() {
  for (let attempt = 0; attempt < QA_BUSY_RETRIES; attempt++) {
    const { response, payload } = await requestQaAuth('prepare');
    if (response.ok) return payload;
    if (response.status === 409 && payload.error === 'QA_BUSY' && attempt < QA_BUSY_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, QA_BUSY_RETRY_MS));
      continue;
    }
    throw new Error(`QA auth prepare failed: ${response.status} ${payload.error || ''}`.trim());
  }
  throw new Error('QA auth prepare retries exhausted');
}

/** Clear canonical Testing QA attempts and release the owned run lease. */
async function cleanupQaRun(runId) {
  const { response, payload } = await requestQaAuth('cleanup', runId);
  if (!response.ok) throw new Error(`QA auth cleanup failed: ${response.status} ${payload.error || ''}`.trim());
  return payload;
}

/** Verify actual persisted resume without logging question content or the learner session. */
export async function assertQaResume(config, session, endpoint, action, fetchImpl = fetch) {
  const request = async () => {
    const response = await fetchQaBackend(config, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey, authorization: `Bearer ${session}` },
      body: JSON.stringify({ action, quiz_slug: QA_QUIZ_SLUG }),
    }, fetchImpl);
    if (!response.ok) throw new Error('QA_LOCAL_RESUME_API_FAILED');
    const payload = await response.json();
    const hiddenKey = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => ['correct_answer', 'explanation', 'grading_config'].includes(key) || hiddenKey(child));
    if (hiddenKey(payload)) throw new Error('QA_LOCAL_ANSWER_KEY_LEAK');
    if (!payload.attempt_id || payload.resumed !== true) throw new Error('QA_LOCAL_RESUME_INVALID');
    return payload.attempt_id;
  };
  if (await request() !== await request()) throw new Error('QA_LOCAL_RESUME_ID_CHANGED');
}

/** Synthetic parent's real Auth password grant and existing membership-bound API. */
export async function assertQaParent(config, email, password, fetchImpl = fetch) {
  if (!email || !password) throw new Error('QA_LOCAL_PARENT_CONFIG_REQUIRED');
  const login = await fetchRunnerLocalAuth(config, '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey }, body: JSON.stringify({ email, password }),
  }, fetchImpl);
  if (!login.ok) throw new Error('QA_LOCAL_PARENT_LOGIN_FAILED');
  const token = (await login.json()).access_token;
  if (!token) throw new Error('QA_LOCAL_PARENT_LOGIN_FAILED');
  let primary;
  try {
    const result = await fetchQaBackend(config, 'family-api', {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey, authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'parent_dashboard' }),
    }, fetchImpl);
    if (!result.ok) throw new Error('QA_LOCAL_PARENT_DASHBOARD_FAILED');
    const data = await result.json();
    if (data.parent?.role !== 'owner' || !Array.isArray(data.learners) || data.learners.length || data.attempts?.length || data.states?.length) throw new Error('QA_LOCAL_PARENT_TEST_EXCLUSION_FAILED');
  } catch (error) { primary = error; }
  try {
    const logout = await fetchRunnerLocalAuth(config, '/auth/v1/logout', { method: 'POST', headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` } }, fetchImpl);
    if (!logout.ok) throw new Error('QA_LOCAL_PARENT_LOGOUT_FAILED');
  } catch (error) { primary ||= error; }
  if (primary) throw primary;
}

/**
 * Execute one owned QA lifecycle and always clean up a returned run ID, even when
 * validation or the browser flow fails. The primary failure takes precedence over
 * a cleanup failure so the original regression remains visible.
 */
export async function runOwnedQaLifecycle({ prepare, validate, run, cleanup }) {
  let prepared;
  let ownedRunId = null;
  let primaryError = null;
  let cleanupError = null;

  try {
    prepared = await prepare();
    ownedRunId = prepared?.run_id || null;
    await validate(prepared);
    await run(prepared);
  } catch (error) {
    primaryError = error;
  } finally {
    if (ownedRunId) {
      try {
        await cleanup(ownedRunId);
      } catch (error) {
        cleanupError = error;
      }
    }
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return prepared;
}

/** Run the authenticated Testing learner browser flow against the real backend. */
async function main() {
  const config = readQaTestingConfig();
  await verifyQaTestingBackend(config);
  const { chromium } = await import('playwright');

  await runOwnedQaLifecycle({
    prepare: prepareQaRun,
    validate: async prepared => {
      if (!prepared.session || prepared.learner?.slug !== 'test' || !prepared.run_id) {
        throw new Error('QA auth returned invalid Testing learner session or run ownership');
      }
      if (prepared.quiz_slug !== QA_QUIZ_SLUG) {
        throw new Error('QA auth returned unexpected canonical quiz');
      }
    },
    run: async prepared => {
      let browser;
      try {
        browser = await chromium.launch(qaBrowserLaunchOptions());
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
        const network = await installQaBrowserIsolation(page.context(), config);
        const errors = [];
        page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

        await page.addInitScript(value => localStorage.setItem('learner_session', value), prepared.session);
        await page.goto(`${APP_URL}?qa=${Date.now()}#student`, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const qaProgram = page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE });
        await qaProgram.waitFor({ state: 'visible', timeout: 10000 });
        await qaProgram.click();
        const qaBook = page.locator('[data-book]').filter({ hasText: QA_BOOK_TITLE });
        await qaBook.waitFor({ state: 'visible', timeout: 10000 });
        await qaBook.click();

        const learningButton = page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`);
        await learningButton.waitFor({ state: 'visible', timeout: 10000 });
        await learningButton.click();
        await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
        await assertQaResume(config, prepared.session, 'learning-api', 'start_quiz');
        for (let i = 0; i < QA_QUESTION_COUNT; i++) {
          await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
          await page.locator('.flh-learn-answer').first().click();
          await page.locator('#flhConfirmAnswer').click();
          const next = page.locator('#flhLearnNext');
          await next.waitFor({ state: 'visible', timeout: 10000 });
          await next.click();
        }

        await page.waitForFunction(
          () => document.querySelector('#learnHome') || document.querySelector('#learnRetryFinish'),
          null,
          { timeout: 30000 },
        );
        const retryFinish = page.locator('#learnRetryFinish');
        if (await retryFinish.isVisible().catch(() => false)) await retryFinish.click();
        await page.locator('#learnHome').waitFor({ state: 'visible', timeout: 30000 });

        await page.evaluate(slug => window.FLH.startExamQuiz(slug), QA_QUIZ_SLUG);
        await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 10000 });
        await assertQaResume(config, prepared.session, 'exam-v2-api', 'start_exam');
        for (let i = 0; i < QA_QUESTION_COUNT; i++) {
          await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 10000 });
          await page.locator('.exam-v3-answer').first().click();
          if (i < QA_QUESTION_COUNT - 1) await page.locator('#examNext').click();
        }
        const submit = page.locator('#examSubmit');
        await page.waitForFunction(() => {
          const button = document.querySelector('#examSubmit');
          return button && !button.disabled;
        }, null, { timeout: 10000 });
        await submit.click();
        await page.locator('.exam-review').first().waitFor({ state: 'visible', timeout: 30000 });

        const attemptId = await page.evaluate(async ({ slug, backendUrl, publishableKey }) => {
          const token = localStorage.getItem('learner_session') || sessionStorage.getItem('learner_session') || '';
          const response = await fetch(`${backendUrl}/functions/v1/attempt-history-api`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              apikey: publishableKey,
              authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: 'list_attempts', page_size: 10, mode: 'exam' }),
            redirect: 'error',
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || 'ATTEMPT_HISTORY_FAILED');
          return payload.items?.find(item => item.context?.quiz?.slug === slug)?.id || null;
        }, { slug: QA_QUIZ_SLUG, backendUrl: config.backendUrl, publishableKey: config.publishableKey });
        if (!attemptId) throw new Error('QA exam attempt was not discoverable in attempt history');

        const direct = new URL(APP_URL);
        direct.searchParams.set('attempt', attemptId);
        direct.searchParams.set('learner', 'test');
        direct.hash = 'student';
        await page.goto(direct.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('.flh-attempt-summary').waitFor({ state: 'visible', timeout: 30000 });
        await page.locator('.flh-history-review').first().waitFor({ state: 'attached', timeout: 30000 });
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'), null, { timeout: 10000 });
        if (new URL(page.url()).searchParams.has('learner')) throw new Error('Attempt deep link did not clean learner query parameter');
        const evidencePath = config.mode === 'runner-local' ? 'qa-authenticated-evidence' : 'playwright-screenshots';
        await mkdir(evidencePath, { recursive: true });
        await page.screenshot({ path: `${evidencePath}/attempt-deep-link-mobile.png`, fullPage: true });

        if (config.mode === 'runner-local') await assertQaParent(config, process.env.FLH_QA_PARENT_EMAIL, process.env.FLH_QA_PARENT_PASSWORD);

        network.assertNoUnexpectedRequests();
        if (errors.length) throw new Error(errors.join('; '));
        console.log('Authenticated QA passed: isolated Testing learner, owned lease, QA-only content, real backend, Learning Mode, Exam Mode, direct attempt deep link.');
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    },
    cleanup: cleanupQaRun,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
