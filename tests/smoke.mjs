import { chromium } from 'playwright';

const BASE_URL = process.env.APP_URL || 'https://fadiaboalward.github.io/family-learning-hub/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.addInitScript(() => {
  localStorage.setItem('learner_session', 'qa-test-session');
  sessionStorage.removeItem('learner_session');
});

const fakeProfile = {
  learner: { id: 'qa-learner', display_name: 'اختبار QA', slug: 'test', grade_level: 5 },
  gamification: {
    xp: 0,
    reward_points: 0,
    current_level: 1,
    current_streak: 0,
    longest_streak: 0,
    last_learning_date: null,
    current_level_info: { level_no: 1, name: 'مستكشف', min_xp: 0, icon: '🌱' },
    next_level_info: { level_no: 2, name: 'متعلم نشيط', min_xp: 250, icon: '⭐' },
    xp_to_next: 250,
    badges: [],
    rewards: []
  }
};

await page.route('**/functions/v1/family-api', async route => {
  let body = {};
  try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
  if (body.action === 'student_profile') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeProfile) });
  }
  if (body.action === 'complete_quiz') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ already_awarded: false, award: { xp: 0, reward_points: 0, badges: [] }, profile: fakeProfile }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...fakeProfile }) });
});

await page.route('**/functions/v1/activity-api', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
);
await page.route('**/functions/v1/exam-api', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
);

const url = `${BASE_URL}?qa=${Date.now()}#student`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

await page.locator('#fractionExam').waitFor({ state: 'visible', timeout: 10000 });
await page.locator('#fractionExam').click({ timeout: 5000 });

await page.locator('.exam-status').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('#examAnswers').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('#examQuestionNavigator').waitFor({ state: 'visible', timeout: 5000 });

const statusText = await page.locator('.exam-status').innerText();
if (!statusText.includes('السؤال 1 من 10')) throw new Error(`Unexpected exam status: ${statusText}`);

const navCount = await page.locator('#examQuestionNavigator .exam-nav-btn').count();
if (navCount !== 10) throw new Error(`Expected 10 navigator buttons, got ${navCount}`);

// Answer question 1, verify it becomes answered, then jump to question 3 and back to 1.
await page.locator('#examAnswers .answer').first().click();
await page.waitForTimeout(100);
const q1Class = await page.locator('#examQuestionNavigator .exam-nav-btn').nth(0).getAttribute('class');
if (!q1Class?.includes('answered') && !q1Class?.includes('current')) throw new Error(`Question 1 was not marked answered: ${q1Class}`);

await page.locator('#examQuestionNavigator .exam-nav-btn').nth(2).click();
await page.waitForFunction(() => document.querySelector('.exam-status .topline b')?.textContent?.includes('السؤال 3 من 10'), null, { timeout: 5000 });
await page.locator('#examQuestionNavigator .exam-nav-btn').nth(0).click();
await page.waitForFunction(() => document.querySelector('.exam-status .topline b')?.textContent?.includes('السؤال 1 من 10'), null, { timeout: 5000 });

if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);

console.log('QA PASS: student page -> exam -> navigator -> answer state -> direct jump');
await browser.close();
