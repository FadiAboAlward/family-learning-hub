import { chromium } from 'playwright';

const BASE_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.addInitScript(() => {
  localStorage.setItem('learner_session', 'qa-test-session');
  sessionStorage.removeItem('learner_session');
});

const fakeProfile = {
  learner: { id: 'qa-learner', display_name: 'اختبار QA', slug: 'test', grade_level: 5 },
  gamification: {
    xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0,
    last_learning_date: null,
    current_level_info: { level_no: 1, name: 'مستكشف', min_xp: 0, icon: '🌱' },
    next_level_info: { level_no: 2, name: 'متعلم نشيط', min_xp: 250, icon: '⭐' },
    xp_to_next: 250, badges: [], rewards: []
  }
};

await page.route('**/functions/v1/family-api', async route => {
  let body = {};
  try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'student_profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeProfile) });
  if (body.action === 'complete_quiz') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ already_awarded: false, award: { xp: 0, reward_points: 0, badges: [] }, profile: fakeProfile }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...fakeProfile }) });
});
await page.route('**/functions/v1/activity-api', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
await page.route('**/functions/v1/exam-api', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

const questionLabel = '.exam-status .topline > b:first-child';
const url = `${BASE_URL}?qa=${Date.now()}#student`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('#fractionExam').waitFor({ state: 'visible', timeout: 10000 });
await page.locator('#fractionExam').click();
await page.locator('.exam-status').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('#examQuestionNavigator').waitFor({ state: 'visible', timeout: 5000 });

const navBox = await page.locator('#examQuestionNavigator').boundingBox();
if (!navBox || navBox.height > 70) throw new Error(`Navigator too tall: ${navBox?.height}`);

await page.locator('#examAnswers .answer').first().click();
await page.locator('#examQuestionNavigator .exam-nav-btn').nth(2).click();
await page.waitForFunction(sel => document.querySelector(sel)?.textContent?.includes('السؤال 3 من 10'), questionLabel, { timeout: 5000 });
await page.locator('#examAnswers .answer').nth(1).click();

await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
await page.waitForFunction(sel => document.querySelector(sel)?.textContent?.includes('السؤال 3 من 10'), questionLabel, { timeout: 10000 });
const restoredQ3 = await page.locator('#examAnswers .answer.selected').getAttribute('data-n');
if (restoredQ3 !== '1') throw new Error(`Q3 answer not restored; got ${restoredQ3}`);
await page.locator('#examQuestionNavigator .exam-nav-btn').nth(0).click();
await page.waitForFunction(sel => document.querySelector(sel)?.textContent?.includes('السؤال 1 من 10'), questionLabel, { timeout: 5000 });
const restoredQ1 = await page.locator('#examAnswers .answer.selected').getAttribute('data-n');
if (restoredQ1 !== '0') throw new Error(`Q1 answer not restored; got ${restoredQ1}`);

for (let q = 1; q <= 10; q++) {
  const current = Number((await page.locator(questionLabel).innerText()).match(/السؤال\s+(\d+)/)?.[1] || 0);
  if (current !== q) {
    await page.locator('#examQuestionNavigator .exam-nav-btn').nth(q-1).click();
    await page.waitForFunction(({sel,n}) => document.querySelector(sel)?.textContent?.includes(`السؤال ${n} من 10`), {sel:questionLabel,n:q}, { timeout: 5000 });
  }
  if (await page.locator('#examAnswers .answer.selected').count() === 0) await page.locator('#examAnswers .answer').first().click();
}
await page.locator('#examQuestionNavigator .exam-nav-btn').nth(9).click();
await page.waitForFunction(sel => document.querySelector(sel)?.textContent?.includes('السؤال 10 من 10'), questionLabel, { timeout: 5000 });
await page.locator('#examSubmit').click();
await page.locator('.exam-review').first().waitFor({ state: 'visible', timeout: 8000 });
await page.waitForTimeout(250);

const reviewCount = await page.locator('.exam-review').count();
if (reviewCount !== 10) throw new Error(`Expected 10 result accordions, got ${reviewCount}`);
const openCount = await page.locator('.exam-review[open]').count();
if (openCount !== 0) throw new Error(`Expected result accordions collapsed, got ${openCount} open`);
const resultNavCount = await page.locator('#examResultNavigator .result-nav-chip').count();
if (resultNavCount !== 10) throw new Error(`Expected 10 result navigator chips, got ${resultNavCount}`);
if (await page.locator('.exam-result-summary-v7').count() !== 1) throw new Error('Result summary v7 not applied');

if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
console.log('QA PASS: exam entry -> compact navigator -> answer state -> refresh persistence -> result accordions/grid');
await browser.close();
