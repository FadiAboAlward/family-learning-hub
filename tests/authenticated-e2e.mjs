import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const QA_AUTH_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/qa-auth';
const QA_QUIZ_SLUG = 'fractions-pages-54-57';

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

async function qaSession() {
  const response = await fetch(QA_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oidc_token: await githubOidcToken() }),
  });
  if (!response.ok) throw new Error(`QA auth failed: ${response.status}`);
  const payload = await response.json();
  if (!payload.session || payload.learner?.slug !== 'test') throw new Error('QA auth returned invalid learner session');
  return payload.session;
}

const session = await qaSession();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

await page.addInitScript(value => localStorage.setItem('learner_session', value), session);
await page.goto(`${APP_URL}?qa=${Date.now()}#student`, { waitUntil: 'networkidle', timeout: 30000 });
await page.getByText('Testing', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });

const programs = page.locator('[data-open-program]');
await programs.first().waitFor({ state: 'visible', timeout: 10000 });
let found = false;
for (let p = 0; p < await programs.count() && !found; p++) {
  await programs.nth(p).click();
  const books = page.locator('[data-book]');
  for (let b = 0; b < await books.count() && !found; b++) {
    await books.nth(b).click();
    const units = page.locator('[data-unit]');
    for (let u = 0; u < await units.count() && !found; u++) {
      await units.nth(u).click();
      if (await page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`).count()) {
        found = true;
        break;
      }
      await page.goBack().catch(() => {});
    }
    if (!found) await page.goBack().catch(() => {});
  }
  if (!found) await page.goBack().catch(() => {});
}
if (!found) throw new Error(`QA quiz ${QA_QUIZ_SLUG} not found in Testing library`);

await page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`).click();
await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
await page.locator('.flh-learn-answer').first().click();
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({ state: 'visible', timeout: 10000 });

await page.evaluate(slug => window.FLH.startExamQuiz(slug), QA_QUIZ_SLUG);
await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 10000 });
for (let i = 0; i < 20; i++) {
  await page.locator('.exam-v3-answer').first().click();
  const submit = page.locator('#examSubmit');
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    break;
  }
  const next = page.locator('#examNext');
  if (!(await next.isVisible().catch(() => false))) break;
  await next.click();
  await page.waitForTimeout(150);
}

if (errors.length) throw new Error(errors.join('; '));
console.log('Authenticated QA passed: Testing learner, real backend, library, Learning Mode, Exam Mode.');
await browser.close();
