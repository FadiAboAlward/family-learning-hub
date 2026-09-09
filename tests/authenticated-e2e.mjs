import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:4173/';
const QA_AUTH_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/qa-auth';
const QA_QUIZ_SLUG = 'qa-automation-core';
const QA_PROGRAM_TITLE = 'QA Automation — Testing';
const QA_BOOK_TITLE = 'QA Automation Book';
const QA_QUESTION_COUNT = 3;

async function githubOidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('GitHub OIDC environment is unavailable');
  const sep = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${sep}audience=family-learning-hub-qa`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!response.ok) throw new Error(`GitHub OIDC request failed: ${response.status}`);
  const payload = await response.json();
  if (!payload.value) throw new Error('GitHub OIDC token missing');
  return payload.value;
}

async function qaAuth(action, runId = null) {
  const response = await fetch(QA_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      oidc_token: await githubOidcToken(),
      ...(runId ? { run_id: runId } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`QA auth ${action} failed: ${response.status} ${payload.error || ''}`.trim());
  return payload;
}

const prepared = await qaAuth('prepare');
if (!prepared.session || prepared.learner?.slug !== 'test' || !prepared.run_id) {
  throw new Error('QA auth returned invalid Testing learner session or run ownership');
}
if (prepared.quiz_slug !== QA_QUIZ_SLUG) throw new Error('QA auth returned unexpected canonical quiz');

let browser;
let primaryError = null;
let cleanupError = null;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

  await page.addInitScript(value => localStorage.setItem('learner_session', value), prepared.session);
  await page.goto(`${APP_URL}?qa=${Date.now()}#student`, { waitUntil: 'networkidle', timeout: 30000 });

  const qaProgram = page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE });
  await qaProgram.waitFor({ state: 'visible', timeout: 10000 });
  await qaProgram.click();
  const qaBook = page.locator('[data-book]').filter({ hasText: QA_BOOK_TITLE });
  await qaBook.waitFor({ state: 'visible', timeout: 10000 });
  await qaBook.click();

  const learningButton = page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`);
  await learningButton.waitFor({ state: 'visible', timeout: 10000 });
  await learningButton.click();
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

  if (errors.length) throw new Error(errors.join('; '));
  console.log('Authenticated QA passed: isolated Testing learner, serialized run ownership, QA-only content, real backend, Learning Mode, Exam Mode.');
} catch (error) {
  primaryError = error;
} finally {
  if (browser) await browser.close().catch(() => {});
  try {
    await qaAuth('cleanup', prepared.run_id);
  } catch (error) {
    cleanupError = error;
  }
}

if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;
