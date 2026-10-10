import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchQaBackend, fetchQaOidc, installQaBrowserIsolation, qaBrowserLaunchOptions, readQaTestingConfig, verifyQaTestingBackend } from './qa-isolation.mjs';
import { AUTHENTICATED_QA_STAGES, fetchRunnerLocalAuth, safeAuthenticatedFailure } from './qa-runner-local.mjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const QA_QUIZ_SLUG = 'qa-automation-core';
const QA_PROGRAM_TITLE = 'QA Automation — Testing';
const QA_BOOK_TITLE = 'QA Automation Book';
const QA_QUESTION_COUNT = 3;
const QA_PARENT_VISIBLE_LEARNER = '02610000-0000-4000-8000-000000000101';
const QA_SIBLING_VISIBLE_LEARNER = '02610000-0000-4000-8000-000000000102';
const QA_BUSY_RETRIES = 20;
const QA_BUSY_RETRY_MS = 10000;

/** Fixed markers only; operation values and original exceptions remain private. */
export async function runAuthenticatedStage(stage, operation, emit = line => console.error(line)) {
  if (!AUTHENTICATED_QA_STAGES.includes(stage)) throw new Error('QA_AUTH_DIAGNOSTIC_STAGE_INVALID');
  emit('QA_AUTH_STAGE '+JSON.stringify({stage,status:'START'}));
  try {
    const value = await operation();
    emit('QA_AUTH_STAGE '+JSON.stringify({stage,status:'PASS'}));
    return value;
  } catch (error) {
    emit('QA_AUTH_FAILURE '+JSON.stringify({stage,...safeAuthenticatedFailure(error)}));
    throw error;
  }
}

function responseFailure(code, response, payload) {
  const error = new Error(code);
  error.qaHttpStatus = response.status;
  error.qaResponseError = payload?.error;
  return error;
}

/** Called on failed flows too; no network origins or browser error messages escape. */
export function assertAuthenticatedBrowserSafety(network, errors, emit = line => console.error(line)) {
  let networkFailed = false;
  if (network) try { network.assertNoUnexpectedRequests(); } catch { networkFailed = true; }
  emit('QA_AUTH_NETWORK '+JSON.stringify({status:network?(networkFailed?'FAIL':'PASS'):'NOT_STARTED',
    unexpected_requests:network?.unexpected?.length||0,browser_errors:errors.length}));
  if (networkFailed) throw new Error('QA_BROWSER_NETWORK_REJECTED');
  if (errors.length) throw new Error('QA_BROWSER_ERRORS');
}

/** Request a GitHub Actions OIDC token scoped to the Family Learning Hub QA audience. */
async function githubOidcToken() {
  return runAuthenticatedStage('OIDC_REQUEST', async () => {
  const config = readQaTestingConfig();
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('GitHub OIDC environment is unavailable');
  const response = await fetchQaOidc(config, url, bearer);
  if (!response.ok) throw responseFailure('QA_OIDC_REQUEST_FAILED', response);
  const payload = await response.json();
  if (!payload.value) throw new Error('QA_OIDC_TOKEN_MISSING');
  return payload.value;
  });
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
    throw responseFailure('QA_AUTH_PREPARE_FAILED', response, payload);
  }
  throw new Error('QA_AUTH_PREPARE_FAILED');
}

/** Clear canonical Testing QA attempts and release the owned run lease. */
async function cleanupQaRun(runId) {
  const { response, payload } = await requestQaAuth('cleanup', runId);
  if (!response.ok) throw responseFailure('QA_AUTH_CLEANUP_FAILED', response, payload);
  return payload;
}

/** Verify actual persisted resume without logging question content or the learner session. */
export async function assertQaResume(config, session, endpoint, action, fetchImpl = fetch) {
  const request = async () => {
    const response = await fetchQaBackend(config, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey, authorization: `Bearer ${session}` },
      body: JSON.stringify({ action, quiz_slug: QA_QUIZ_SLUG }),
    }, fetchImpl);
    if (!response.ok) throw responseFailure('QA_LOCAL_RESUME_API_FAILED', response);
    const payload = await response.json();
    const hiddenKey = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) => ['correct_answer', 'explanation', 'grading_config'].includes(key) || hiddenKey(child));
    if (hiddenKey(payload)) throw new Error('QA_LOCAL_ANSWER_KEY_LEAK');
    if (!payload.attempt_id || payload.resumed !== true) throw new Error('QA_LOCAL_RESUME_INVALID');
    return payload.attempt_id;
  };
  if (await request() !== await request()) throw new Error('QA_LOCAL_RESUME_ID_CHANGED');
}

/** Verify the submitted synthetic result while preserving a collapsed correct-answer group. */
export async function assertQaExamCompletion(page) {
  await page.locator('#examHome').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText('100%', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  const reviews = page.locator('.exam-review');
  await reviews.first().waitFor({ state: 'attached', timeout: 30000 });
  if (await reviews.count() !== QA_QUESTION_COUNT) throw new Error('QA_LOCAL_EXAM_REVIEW_INVALID');
  const grouped = page.locator('.flh-correct-review');
  const groupCount = await grouped.count();
  if (groupCount) {
    if (groupCount !== 1) throw new Error('QA_LOCAL_EXAM_REVIEW_INVALID');
    await grouped.locator(':scope > summary').waitFor({ state: 'visible', timeout: 30000 });
    if (await grouped.getAttribute('open') !== null || await page.locator('.exam-review-wrong').count() !== 0) {
      throw new Error('QA_LOCAL_EXAM_REVIEW_INVALID');
    }
  } else await reviews.first().waitFor({ state: 'visible', timeout: 30000 });
}

/** Read-only device layout evidence; independent of provider fixtures and browser dimensions. */
export async function assertQaDeviceLayout(page, expectedWidth) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    hasError: !!document.querySelector('[data-family-rewards] .error'),
  }));
  if (dimensions.viewport !== expectedWidth || dimensions.document > expectedWidth + 2
      || dimensions.body > expectedWidth + 2 || dimensions.hasError) throw new Error('QA_LOCAL_DEVICE_LAYOUT_INVALID');
}

/** Arm before the click: awaiting a dialog-triggering click first deadlocks Playwright. */
export async function handleQaParentBulkConfirmation(page, button, expectedCount, accept = true) {
  const confirmation = new Promise((resolve, reject) => {
    page.once('dialog', async dialog => {
      try {
        if (dialog.type() !== 'confirm' || !dialog.message().includes(`عدد الطلبات: ${expectedCount}`)) {
          await dialog.dismiss();
          throw new Error('QA_LOCAL_PARENT_CONFIRMATION_INVALID');
        }
        if (accept) await dialog.accept(); else await dialog.dismiss();
        resolve(true);
      } catch (error) { reject(error); }
    });
  });
  await Promise.all([button.click({ timeout: 10000 }), confirmation]);
}

/** Synthetic parent's real Auth password grant and existing membership-bound API. */
export async function assertQaParent(config, email, password, fetchImpl = fetch, verifyBrowser = null) {
  if (!email || !password) throw new Error('QA_LOCAL_PARENT_CONFIG_REQUIRED');
  const login = await fetchRunnerLocalAuth(config, '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey }, body: JSON.stringify({ email, password }),
  }, fetchImpl);
  if (!login.ok) throw responseFailure('QA_LOCAL_PARENT_LOGIN_FAILED', login);
  const token = (await login.json()).access_token;
  if (!token) throw new Error('QA_LOCAL_PARENT_LOGIN_FAILED');
  let primary;
  try {
    const result = await fetchQaBackend(config, 'family-api', {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: config.publishableKey, authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'parent_dashboard' }),
    }, fetchImpl);
    if (!result.ok) throw responseFailure('QA_LOCAL_PARENT_DASHBOARD_FAILED', result);
    const data = await result.json();
    if (data.parent?.role !== 'owner' || !Array.isArray(data.learners) ||
      data.learners.length !== 2 ||
      !data.learners.some(row => row.id === QA_PARENT_VISIBLE_LEARNER && row.slug === 'qa-parent-visible') ||
      !data.learners.some(row => row.id === QA_SIBLING_VISIBLE_LEARNER && row.slug === 'qa-sibling-visible') ||
      data.attempts?.length ||
      (data.states || []).some(row => ![QA_PARENT_VISIBLE_LEARNER, QA_SIBLING_VISIBLE_LEARNER].includes(row.learner_id))) {
      throw new Error('QA_LOCAL_PARENT_TEST_EXCLUSION_FAILED');
    }
    // Read-only real-browser device QA runs only after authorization and test-only exclusion.
    if (verifyBrowser) await verifyBrowser(token);
  } catch (error) { primary = error; }
  try {
    const logout = await fetchRunnerLocalAuth(config, '/auth/v1/logout', { method: 'POST', headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` } }, fetchImpl);
    if (!logout.ok) throw responseFailure('QA_LOCAL_PARENT_LOGOUT_FAILED', logout);
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
  const config = await runAuthenticatedStage('CONFIG', () => readQaTestingConfig());
  await runAuthenticatedStage('ATTESTATION', () => verifyQaTestingBackend(config));
  const { chromium } = await runAuthenticatedStage('PLAYWRIGHT_IMPORT', () => import('playwright'));

  await runOwnedQaLifecycle({
    prepare: () => runAuthenticatedStage('AUTH_PREPARE', prepareQaRun),
    validate: prepared => runAuthenticatedStage('SESSION_VALIDATION', async () => {
      if (!prepared.session || prepared.learner?.slug !== 'test' || !prepared.run_id) {
        throw new Error('QA_AUTH_SESSION_INVALID');
      }
      if (prepared.quiz_slug !== QA_QUIZ_SLUG) {
        throw new Error('QA_AUTH_QUIZ_INVALID');
      }
    }),
    run: async prepared => {
      let browser, network, primary;
      const errors = [];
      try {
        browser = await runAuthenticatedStage('BROWSER_LAUNCH', () => chromium.launch(qaBrowserLaunchOptions()));
        const page = await runAuthenticatedStage('BROWSER_LAUNCH', async () => {
          const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
          network = await installQaBrowserIsolation(page.context(), config);
          return page;
        });
        page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

        await runAuthenticatedStage('BROWSER_NAVIGATION', async () => {
        await page.addInitScript(value => localStorage.setItem('learner_session', value), prepared.session);
        await page.goto(`${APP_URL}?qa=${Date.now()}#student`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        });

        const qaProgram = page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE });
        await runAuthenticatedStage('PROGRAM_READY', () => qaProgram.waitFor({ state: 'visible', timeout: 10000 }));
        await runAuthenticatedStage('PROGRAM_OPEN', () => qaProgram.click());
        const qaBook = page.locator('[data-book]').filter({ hasText: QA_BOOK_TITLE });
        await runAuthenticatedStage('BOOK_READY', () => qaBook.waitFor({ state: 'visible', timeout: 10000 }));
        await runAuthenticatedStage('BOOK_OPEN', () => qaBook.click());

        await runAuthenticatedStage('LEARNING_OPEN', async () => {
        const learningButton = page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`);
        await learningButton.waitFor({ state: 'visible', timeout: 10000 });
        await learningButton.click();
        await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
        });
        await runAuthenticatedStage('LEARNING_RESUME', () => assertQaResume(config, prepared.session, 'learning-api', 'start_quiz'));
        await runAuthenticatedStage('LEARNING_ANSWERS', async () => {
        for (let i = 0; i < QA_QUESTION_COUNT; i++) {
          // This answer is known from the isolated synthetic fixture, never a
          // key read from a learner response or a real academic package.
          const answer = page.locator('.flh-learn-answer').filter({ has: page.getByText('Accept', { exact: true }) });
          await answer.waitFor({ state: 'visible', timeout: 10000 });
          await answer.click();
          await page.locator('#flhConfirmAnswer').click();
          const next = page.locator('#flhLearnNext');
          await next.waitFor({ state: 'visible', timeout: 10000 });
          await next.click();
        }
        });

        await runAuthenticatedStage('LEARNING_FINISH', async () => {
        await page.waitForFunction(
          () => document.querySelector('#learnHome') || document.querySelector('#learnRetryFinish'),
          null,
          { timeout: 30000 },
        );
        const retryFinish = page.locator('#learnRetryFinish');
        if (await retryFinish.isVisible().catch(() => false)) await retryFinish.click();
        await page.locator('#learnHome').waitFor({ state: 'visible', timeout: 30000 });
        });

        await runAuthenticatedStage('EXAM_OPEN', async () => {
        await page.evaluate(slug => window.FLH.startExamQuiz(slug), QA_QUIZ_SLUG);
        await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 10000 });
        });
        await runAuthenticatedStage('EXAM_RESUME', () => assertQaResume(config, prepared.session, 'exam-v2-api', 'start_exam'));
        await runAuthenticatedStage('EXAM_ANSWERS', async () => {
        for (let i = 0; i < QA_QUESTION_COUNT; i++) {
          const answer = page.locator('.exam-v3-answer').filter({ has: page.getByText('Accept', { exact: true }) });
          await answer.waitFor({ state: 'visible', timeout: 10000 });
          await answer.click();
          if (i < QA_QUESTION_COUNT - 1) await page.locator('#examNext').click();
        }
        });
        await runAuthenticatedStage('EXAM_SUBMIT', async () => {
        const submit = page.locator('#examSubmit');
        await page.waitForFunction(() => {
          const button = document.querySelector('#examSubmit');
          return button && !button.disabled;
        }, null, { timeout: 10000 });
        await submit.click();
        await assertQaExamCompletion(page);
        });

        const attemptId = await runAuthenticatedStage('ATTEMPT_DISCOVERY', async () => {
        const foundId = await page.evaluate(async ({ slug, backendUrl, publishableKey }) => {
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
        if (!foundId) throw new Error('QA_LOCAL_ATTEMPT_NOT_FOUND');
        return foundId;
        });

        await runAuthenticatedStage('DEEP_LINK', async () => {
        const direct = new URL(APP_URL);
        direct.searchParams.set('attempt', attemptId);
        direct.searchParams.set('learner', 'test');
        direct.hash = 'student';
        await page.goto(direct.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('.flh-attempt-summary').waitFor({ state: 'visible', timeout: 30000 });
        await page.locator('.flh-history-review').first().waitFor({ state: 'attached', timeout: 30000 });
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('attempt'), null, { timeout: 10000 });
        if (new URL(page.url()).searchParams.has('learner')) throw new Error('QA_LOCAL_DEEP_LINK_QUERY_REMAIN');
        });
        await runAuthenticatedStage('SCREENSHOT', async () => {
        const evidencePath = config.mode === 'runner-local' ? 'qa-authenticated-evidence' : 'playwright-screenshots';
        await mkdir(evidencePath, { recursive: true });
        await page.screenshot({ path: `${evidencePath}/attempt-deep-link-mobile.png`, fullPage: true });
        });

        await runAuthenticatedStage('LEARNER_DESKTOP', async () => {
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.locator('.flh-attempt-summary').waitFor({ state: 'visible', timeout: 10000 });
          await assertQaDeviceLayout(page, 1280);
          await page.screenshot({ path: 'qa-authenticated-evidence/attempt-deep-link-desktop.png', fullPage: true });
        });

        if (config.mode === 'runner-local') await runAuthenticatedStage('PARENT_AUTH', () => assertQaParent(
          config, process.env.FLH_QA_PARENT_EMAIL, process.env.FLH_QA_PARENT_PASSWORD, fetch,
          async parentToken => {
            const parentContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
            let parentNetwork;
            try {
              parentNetwork = await installQaBrowserIsolation(parentContext, config);
              await parentContext.addInitScript(value => localStorage.setItem('parent_session', JSON.stringify({ access_token: value })), parentToken);
              const parentPage = await parentContext.newPage();
              parentPage.on('pageerror', error => errors.push(`parent pageerror: ${error.message}`));
              parentPage.on('console', message => { if (message.type() === 'error') errors.push(`parent console: ${message.text()}`); });

              await runAuthenticatedStage('PARENT_DEVICE_MOBILE', async () => {
                await parentPage.goto(`${APP_URL}#parents`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await parentPage.locator('[data-parent-center-nav]').waitFor({ state: 'visible', timeout: 15000 });
                await assertQaDeviceLayout(parentPage, 390);
                if (await parentPage.locator('.card').filter({ hasText: 'QA Isolated Parent Learner' }).count() !== 1 ||
                    await parentPage.locator('.card').filter({ hasText: 'QA Isolated Sibling Learner' }).count() !== 1 ||
                    await parentPage.locator('.card').filter({ hasText: 'QA Automation' }).count()) throw new Error('QA_LOCAL_PARENT_TEST_EXCLUSION_FAILED');
                await parentPage.screenshot({ path: 'qa-authenticated-evidence/parent-dashboard-mobile.png', fullPage: true });
              });
              await runAuthenticatedStage('PARENT_REWARDS_MOBILE', async () => {
                await parentPage.goto(`${APP_URL}#parent-rewards`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const root = parentPage.locator('[data-family-rewards][data-role="parent"]');
                await root.waitFor({ state: 'visible', timeout: 15000 });
                await parentPage.waitForFunction(() => {
                  const root = document.querySelector('[data-family-rewards][data-role="parent"]');
                  return root && !root.querySelector('.loading-card');
                }, null, { timeout: 15000 });
                await assertQaDeviceLayout(parentPage, 390);
                const group = parentPage.locator(`[data-fr-approval-learner="${QA_PARENT_VISIBLE_LEARNER}"]`);
                await group.waitFor({ state: 'visible', timeout: 15000 });
                const sibling = parentPage.locator(`[data-fr-approval-learner="${QA_SIBLING_VISIBLE_LEARNER}"]`);
                if (await group.locator('[data-fr-submission]').count() !== 2 ||
                    await group.locator('[data-fr-pending-count]').count() !== 1 ||
                    await sibling.locator('[data-fr-submission]').count() !== 1) throw new Error('QA_LOCAL_PARENT_PENDING_INVALID');
                await parentPage.screenshot({ path: 'qa-authenticated-evidence/parent-rewards-mobile.png', fullPage: true });
              });
              await runAuthenticatedStage('PARENT_REWARDS_DESKTOP', async () => {
                await parentPage.setViewportSize({ width: 1280, height: 900 });
                await assertQaDeviceLayout(parentPage, 1280);
                const group = parentPage.locator(`[data-fr-approval-learner="${QA_PARENT_VISIBLE_LEARNER}"]`);
                if (await group.locator('[data-fr-submission]').count() !== 2 ||
                    await parentPage.locator(`[data-fr-approval-learner="${QA_SIBLING_VISIBLE_LEARNER}"] [data-fr-submission]`).count() !== 1)
                  throw new Error('QA_LOCAL_PARENT_PENDING_INVALID');
                const submittedIds = await group.locator('[data-fr-submission]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-fr-submission')));
                if (submittedIds.length !== 2 || new Set(submittedIds).size !== 2 ||
                    submittedIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('QA_LOCAL_PARENT_SUBMISSION_IDS_INVALID');
                await parentPage.screenshot({ path: 'qa-authenticated-evidence/parent-rewards-desktop.png', fullPage: true });
                await runAuthenticatedStage('PARENT_BULK_CANCEL', async () => {
                  await handleQaParentBulkConfirmation(parentPage, group.locator('[data-fr-approve-all]'), 2, false);
                  const cards = group.locator('[data-fr-submission]');
                  if (await cards.count() !== 2 ||
                      (await group.locator('[data-fr-pending-count]').textContent())?.trim() !== '2' ||
                      await group.locator('[data-fr-approve-all]').isDisabled()) {
                    throw new Error('QA_LOCAL_PARENT_CANCEL_MUTATED_PENDING');
                  }
                  await assertQaDeviceLayout(parentPage, 1280);
                });
                await runAuthenticatedStage('PARENT_BULK_APPROVAL', async () => {
                  await handleQaParentBulkConfirmation(parentPage, group.locator('[data-fr-approve-all]'), 2);
                  await parentPage.waitForFunction(() => {
                    const root = document.querySelector('[data-family-rewards][data-role="parent"]');
                    return root &&
                      !root.querySelector('[data-fr-approval-learner="02610000-0000-4000-8000-000000000101"]') &&
                      root.querySelectorAll('[data-fr-approval-learner="02610000-0000-4000-8000-000000000102"] [data-fr-submission]').length === 1 &&
                      root.querySelector('[role="status"]')?.textContent?.includes('تم اعتماد 2 من 2');
                  }, null, { timeout: 20000 });
                  await assertQaDeviceLayout(parentPage, 1280);
                  if (await parentPage.locator(`[data-fr-approval-learner="${QA_SIBLING_VISIBLE_LEARNER}"] [data-fr-submission]`).count() !== 1)
                    throw new Error('QA_LOCAL_SIBLING_CROSS_APPROVED');
                });
                await runAuthenticatedStage('PARENT_REVIEW_REPLAY_GUARD', async () => {
                  // Authenticated parent API, never a service-role shortcut. Re-review
                  // MUST NOT re-award and must reject the opposite transition.
                  const review = async (submission_id, decision) => fetchQaBackend(config, 'family-api', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', apikey: config.publishableKey, authorization: `Bearer ${parentToken}` },
                    body: JSON.stringify({ action: 'behavior_review', submission_id, decision }),
                  });
                  for (const id of submittedIds) {
                    const replay = await review(id, 'approved');
                    if (!replay.ok) throw new Error('QA_LOCAL_PARENT_REPLAY_HTTP_INVALID');
                    const body = await replay.json();
                    if (body.already_reviewed !== true || body.submission?.id !== id ||
                        body.submission?.status !== 'approved') throw new Error('QA_LOCAL_PARENT_REPLAY_RESULT_INVALID');
                  }
                  const opposite = await review(submittedIds[0], 'rejected');
                  const rejected = await opposite.json().catch(() => ({}));
                  if (opposite.status !== 409 || rejected?.error !== 'INVALID_TRANSITION') {
                    throw new Error('QA_LOCAL_PARENT_REVIEW_TRANSITION_INVALID');
                  }
                });
              });
              parentNetwork.assertNoUnexpectedRequests();
            } finally {
              await parentContext.close().catch(() => {});
            }
          }
        ));
      } catch (error) {
        primary = error;
      } finally {
        if (browser) await browser.close().catch(() => {});
        try { await runAuthenticatedStage('BROWSER_SAFETY', () => assertAuthenticatedBrowserSafety(network, errors)); } catch (error) { primary ||= error; }
      }
      if (primary) throw primary;
      console.log('Authenticated QA passed: isolated Testing learner, owned lease, QA-only content, real backend, Learning Mode, Exam Mode, direct attempt deep link.');
    },
    cleanup: runId => runAuthenticatedStage('AUTH_CLEANUP', () => cleanupQaRun(runId)),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) { console.error('QA_AUTH_TERMINAL '+JSON.stringify(safeAuthenticatedFailure(error))); process.exitCode = 1; }
}
