import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:4173/';
const QA_AUTH_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co/functions/v1/qa-auth';
const QA_QUIZ_SLUG = 'fractions-pages-54-57';
const QA_PROGRAM_TITLE = 'المنهاج السوري — الصف الخامس — 2025–2026';
const QA_BOOK_TITLE = 'الرياضيات - كتاب التلميذ - الصف الخامس';

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
await page.locator('.flh-learn-answer').first().click();
await page.locator('#flhConfirmAnswer').click();
await page.locator('#flhLearnNext').waitFor({ state: 'visible', timeout: 10000 });

await page.evaluate(slug => window.FLH.startExamQuiz(slug), QA_QUIZ_SLUG);
await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 10000 });
let submitted = false;
for (let i = 0; i < 20; i++) {
  await page.locator('.exam-v3-answer').first().click();
  const submit = page.locator('#examSubmit');
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    submitted = true;
    break;
  }
  const next = page.locator('#examNext');
  if (!(await next.isVisible().catch(() => false))) break;
  await next.click();
  await page.waitForTimeout(150);
}
if (!submitted) throw new Error('Testing exam did not reach submission');
if (errors.length) throw new Error(errors.join('; '));
console.log('Authenticated QA passed: Testing learner, real backend, library, Learning Mode, Exam Mode.');
await browser.close();
