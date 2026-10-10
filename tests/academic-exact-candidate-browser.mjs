import { launchMockQaBrowser } from './qa-isolation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Exact immutable candidate, not a hand-retyped approximation or a real learner assignment.
const candidate = JSON.parse(fs.readFileSync(new URL('./fixtures/academic-content-quality/english-unit1-source-grounded-20.json', import.meta.url), 'utf8'));
const questions = candidate.questions;
assert.equal(questions.length, 20, 'The complete twenty-question candidate is required.');
assert.ok(questions.every(q => q.delivery_surface === 'exam' && q.options.length === 4));
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const browser = await launchMockQaBrowser(chromium, APP_URL);
const screenshotDir = 'playwright-screenshots';

function respond(route, payload, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
}

async function run(device) {
  const page = await browser.newPage({ viewport: device.viewport, isMobile: device.mobile, hasTouch: device.mobile });
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.name));
  page.on('console', message => { if (message.type() === 'error') errors.push('CONSOLE_ERROR'); });
  try {
    await page.route('**/functions/v1/**', route => {
      unexpected.push(new URL(route.request().url()).pathname);
      return route.abort('blockedbyclient');
    });
    await page.route('**/functions/v1/family-api', route => {
      const body = route.request().postDataJSON() || {};
      const profile = {
        learner: { id: '11111111-1111-4111-8111-111111111111', slug: 'qa-candidate', display_name: 'Synthetic Testing Learner', grade_level: 7, is_test: true },
        gamification: { xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0, badges: [], rewards: [] },
      };
      return respond(route, body.action === 'student_profile' ? profile : body.action === 'learner_choices' ? { learners: [] } : { ok: true });
    });
    await page.route('**/functions/v1/student-library-api', route => respond(route, { programs: [], standalone_books: [] }));
    await page.route('**/functions/v1/activity-api', route => respond(route, { ok: true }));
    await page.route('**/functions/v1/question-reference-api', route => respond(route, { codes: {} }));
    await page.route('**/functions/v1/attempt-history-api', route => respond(route, { items: [], has_more: false, next_cursor: null, mode: 'all' }));
    await page.route('**/functions/v1/exam-v2-api', route => {
      const request = route.request().postDataJSON() || {};
      if (request.action === 'warmup') return respond(route, { ok: true });
      if (request.action === 'start_exam') {
        return respond(route, {
          attempt_id: 'qa-english-u1-exact-candidate',
          resumed: false,
          quiz: { slug: 'qa-en7-u1-exact-candidate', title: 'QA — Appearance and Personality' },
          questions: questions.map((q, index) => ({
            question_id: 'qa-exact-' + (index + 1),
            saved_response: null,
            is_flagged: false,
            question: {
              id: 'qa-exact-' + (index + 1),
              question_code: q.question_code,
              prompt: q.prompt,
              prompt_language: q.prompt_language,
              options: q.options.map(option => ({ position: option.position, content: option.content })),
              assets: [],
            },
          })),
        });
      }
      if (request.action === 'save_answer' || request.action === 'set_flag') return respond(route, { ok: true });
      return respond(route, { error: 'QA_UNEXPECTED_EXAM_ACTION' }, 400);
    });
    await page.goto(APP_URL + '#student', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.FLH?.startExamQuiz === 'function');
    await page.evaluate(() => localStorage.setItem('learner_session', 'qa.exact.candidate'));
    await page.evaluate(() => window.FLH.startExamQuiz('qa-en7-u1-exact-candidate'));
    await page.locator('.exam-v3-answer').first().waitFor({ state: 'visible', timeout: 15000 });
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    for (let i = 0; i < questions.length; i++) {
      const expected = questions[i];
      await page.waitForFunction(text => document.querySelector('.question')?.textContent?.includes(text), expected.prompt, { timeout: 15000 });
      const prompt = page.locator('.question').first();
      assert.equal(await prompt.getAttribute('lang'), 'en', 'English language tag must remain attached to the exact prompt.');
      assert.equal(await prompt.evaluate(el => getComputedStyle(el).direction), 'ltr', 'English questions render LTR inside Arabic UI.');
      assert.ok((await prompt.innerText()).includes(expected.prompt), 'Exact candidate prompt must render without omission: ' + expected.question_code);
      const options = page.locator('.exam-v3-answer');
      assert.equal(await options.count(), 4, 'Every exact candidate has four visible answer controls.');
      for (let j = 0; j < 4; j++) {
        assert.ok((await options.nth(j).innerText()).includes(expected.options[j].content), 'Rendered candidate option mismatched: ' + expected.question_code);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2 || document.body.scrollWidth > window.innerWidth + 2);
      assert.equal(overflow, false, 'Horizontal overflow in ' + device.name + ': ' + expected.question_code);
      if ([0, 9, 19].includes(i)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: screenshotDir + '/academic-exact-' + device.name + '-' + String(i + 1).padStart(2, '0') + '.png', fullPage: true });
      }
      await options.first().click();
      if (i < questions.length - 1) await page.locator('#examNext').click();
    }
    assert.equal(await page.locator('#examSubmit').isDisabled(), false, 'The entire exact candidate can reach the final submit action.');
    assert.deepEqual(unexpected, [], 'No unmocked or real backend calls are permitted.');
    assert.deepEqual(errors, [], 'Candidate render must not raise page or console errors.');
    console.log('Exact candidate Exam UI QA PASS: ' + device.name + ', 20 questions, 4 options each, LTR in RTL shell, overflow and errors checked.');
  } finally {
    await page.close();
  }
}

try {
  await run({ name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true });
  await run({ name: 'desktop', viewport: { width: 1365, height: 900 }, mobile: false });
} finally {
  await browser.close();
}
