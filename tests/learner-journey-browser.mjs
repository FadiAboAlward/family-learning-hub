import { launchMockQaBrowser } from './qa-isolation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { deriveLearnerJourney } from '../supabase/functions/_shared/learner-journey.mjs';

// FLH-024 v1.1 / Drive revision 2. Actual active UI; only synthetic Testing APIs.
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const W = 'qa-workspace', A = 'qa-testing-a.signed', B = 'qa-testing-b.signed';
const UUID = n => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = (second = false) => ({ learner: { id: second ? UUID(2) : UUID(1), slug: 'test', is_test: true,
  display_name: second ? 'جلسة اختبار ثانية' : 'طالب الاختبار', grade_level: 7, avatar_emoji: '🧪' },
  gamification: { xp: 0, reward_points: 0, current_level: 1, current_streak: 0, longest_streak: 0, badges: [], rewards: [] } });
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

function fixture() {
  const calls = [];
  let learningDone = false, examActive = false, failNextCatalog = false, delayNextCatalog = false, releaseDelay;
  let delayedCaptured;
  const captured = new Promise(resolve => { delayedCaptured = resolve; });
  const version = (q, id = UUID(10), version_no = 1) => ({ id, quiz_id: q.id, version_no, workspace_id: W, state: 'published' });
  const attempt = (q, mode, status, id = UUID(20)) => ({ id, quiz_version_id: UUID(10), workspace_id: W, learner_id: UUID(1),
    delivery_mode: mode, status, started_at: '2026-10-08T10:00:00Z', submitted_at: status === 'submitted' ? '2026-10-08T11:00:00Z' : null });
  function activity(slug, title, state, config = {}) {
    const q = { id: slug, slug, title, delivery_config: config };
    let attempts = [];
    if (state === 'CONTINUE_LEARNING') attempts = [attempt(q, 'learning', 'in_progress')];
    if (state === 'START_EXAM') attempts = [attempt(q, 'learning', 'submitted'), ...(slug === 'qa-exam-ready' && examActive ? [attempt(q, 'exam', 'in_progress', UUID(22))] : [])];
    if (state === 'COMPLETE') attempts = [attempt(q, config.exam?.enabled === false ? 'learning' : 'exam', 'submitted', UUID(21))];
    q.journey = deriveLearnerJourney({ quiz: q, versions: [version(q)], attempts, workspaceId: W, learnerId: UUID(1), programAccess: state !== 'UNAVAILABLE' });
    return q;
  }
  function catalog(second = false) {
    if (second) return { programs: [{ id: 'second-program', title: 'محتوى جلسة الاختبار الثانية', books: [], program_type: 'curriculum' }], standalone_books: [], standalone_assessments: [] };
    const qs = [activity('qa-complete', 'نشاط مكتمل', 'COMPLETE'), activity('qa-new', 'نشاط جديد', 'NEW'),
      activity('qa-continue', 'تابع نشاطك المحفوظ', learningDone ? 'START_EXAM' : 'CONTINUE_LEARNING'), activity('qa-exam-ready', 'جاهز للامتحان', 'START_EXAM'),
      activity('qa-support', 'تمرين تعلّم فقط', 'COMPLETE', { support_session: true, exam: { enabled: false } }), activity('qa-unavailable', 'نشاط يحتاج إتاحة', 'UNAVAILABLE')];
    return { programs: [{ id: 'p', title: 'منهاج الاختبار', program_type: 'curriculum', grade_level: 7, is_primary: true,
      books: [{ id: 'b', title: 'كتاب الاختبار', units: [{ id: 'u', title: 'وحدة الاختبار', quizzes: qs }], extras: [] }] }], standalone_books: [],
      standalone_assessments: [activity('qa-bookless-complete', 'نتيجة نشاط مستقل', 'COMPLETE'), activity('qa-bookless-new', 'نشاط مخصص دون كتاب', 'NEW')] };
  }
  const question = { id: UUID(30), question_code: 'QA-JOURNEY-V1', question_type: 'single_choice', prompt_language: 'ar',
    prompt: 'سؤال النسخة الأصلية: اختر العدد 2.', options: [{ position: 1, content: '2' }, { position: 2, content: '3' }], assets: [] };
  return {
    calls, captured,
    failCatalog: () => { failNextCatalog = true; }, delayCatalog: () => { delayNextCatalog = true; }, release: () => releaseDelay?.(),
    count: (endpoint, action) => calls.filter(c => c.endpoint === endpoint && c.action === action).length,
    async handle(route) {
      const endpoint = new URL(route.request().url()).pathname.split('/').at(-1), body = route.request().postDataJSON() || {};
      const second = route.request().headers().authorization === `Bearer ${B}`;
      calls.push({ endpoint, ...structuredClone(body), second });
      if (endpoint === 'student-library-api') {
        assert.equal(body.action, 'catalog'); const data = catalog(second);
        if (failNextCatalog) { failNextCatalog = false; return json(route, { error: 'JOURNEY_UNAVAILABLE' }, 500); }
        if (delayNextCatalog && !second) { delayNextCatalog = false; delayedCaptured(); await new Promise(resolve => { releaseDelay = resolve; }); }
        return json(route, data);
      }
      if (endpoint === 'family-api') {
        if (body.action === 'student_profile') return json(route, profile(second));
        if (body.action === 'learner_choices') return json(route, { learners: [profile().learner] });
        return json(route, { ok: true });
      }
      if (endpoint === 'activity-api') return json(route, { ok: true });
      if (endpoint === 'question-reference-api') return json(route, { codes: {} });
      if (endpoint === 'attempt-history-api') {
        if (body.action === 'list_attempts') return json(route, { items: [], has_more: false });
        assert.equal(body.action, 'attempt_detail'); assert.equal(body.attempt_id, UUID(21));
        return json(route, { attempt: { id: UUID(21), delivery_mode: 'exam', percentage: 0, wrong_count: 1, duration_seconds: 30,
          submitted_at: '2026-10-08T11:00:00Z', context: { quiz: { title: 'مراجعة نتيجة الاختبار' } } },
          review: [{ question_id: UUID(30), prompt: question.prompt, prompt_language: 'ar', selected_option: { content: '3' }, correct_option: { content: '2' },
            is_correct: false, explanation: 'طلب السؤال اختيار العدد 2؛ العدد 3 مختلف عنه.' }] });
      }
      if (endpoint === 'learning-api') {
        if (body.action === 'start_quiz') {
          assert.ok(['qa-continue', 'qa-bookless-new'].includes(body.quiz_slug));
          assert.deepEqual(Object.keys(body).sort(), ['action', 'quiz_slug']);
          return json(route, { attempt_id: UUID(20), started_at: '2026-10-08T10:00:00Z', resumed: true,
            quiz: { slug: body.quiz_slug, title: 'تدريب النسخة الأصلية' }, optional_video: null,
            queue: [{ question_id: UUID(30), source_role: 'core', status: 'active', question, draft_option_position: null, hint_level_requested: 0 }] });
        }
        if (body.action === 'save_draft') return json(route, { ok: true });
        if (body.action === 'answer') return json(route, { finalized: true, is_correct: true, explanation: 'اخترت العدد المطلوب.' });
        if (body.action === 'finish_quiz') { learningDone = true; return json(route, { percentage: 100, first_try_correct: 1, hints_used: 0, award: { already_awarded: true }, review: [] }); }
        assert.fail(`Unexpected Learning action ${body.action}`);
      }
      if (endpoint === 'exam-v2-api') {
        assert.equal(body.action, 'start_exam'); assert.equal(body.quiz_slug, 'qa-exam-ready');
        assert.deepEqual(Object.keys(body).sort(), ['action', 'quiz_slug']);
        const resumed = examActive; examActive = true;
        return json(route, { attempt_id: UUID(22), started_at: '2026-10-08T10:00:00Z', resumed, quiz: { slug: body.quiz_slug, title: 'امتحان النسخة الأصلية' },
          questions: [{ question_id: UUID(30), saved_response: null, is_flagged: false, question }] });
      }
      assert.fail(`Unrecognized backend ${endpoint}; tests never forward to Production`);
    },
  };
}

const openUnit = async page => { await page.locator('[data-open-program="0"]').click(); await page.locator('[data-book="0"]').click(); await page.locator('[data-unit="0"]').click(); };
const card = (page, slug) => page.locator('.flh-activity-card').filter({ has: page.locator(`[data-learn="${slug}"], [data-exam="${slug}"]`) }).first();
const overflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
const browser = await launchMockQaBrowser(chromium, APP_URL);
try {
  for (const device of [{ name: 'mobile', viewport: { width: 390, height: 844 } }, { name: 'desktop', viewport: { width: 1280, height: 900 } }]) {
    const data = fixture(), context = await browser.newContext({ viewport: device.viewport }), page = await context.newPage();
    const pageErrors = [], failedResponses = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) failedResponses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    await context.addInitScript(token => { if (!localStorage.getItem('learner_session')) localStorage.setItem('learner_session', token); }, A);
    await context.route('**/functions/v1/*', route => data.handle(route));
    await page.goto(`${APP_URL}?journey-testing#student`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-open-program="0"]').waitFor();
    const bookless = page.locator('.flh-activity-card').filter({ hasText: 'نشاط مخصص دون كتاب' });
    assert.equal(await bookless.locator('[data-journey-primary]').getAttribute('data-learn'), 'qa-bookless-new');
    assert.equal(data.count('learning-api', 'start_quiz'), 0, 'catalog does not start Learning');
    assert.equal(data.count('exam-v2-api', 'start_exam'), 0, 'catalog does not start Exam');
    await openUnit(page);
    assert.deepEqual(await page.locator('.flh-journey').evaluateAll(nodes => nodes.map(n => n.dataset.journeyState)),
      ['NEW', 'CONTINUE_LEARNING', 'START_EXAM', 'COMPLETE', 'COMPLETE', 'UNAVAILABLE']);
    for (const journey of await page.locator('.flh-journey').all()) {
      assert.equal(await journey.locator('[data-journey-primary]').count(), (await journey.getAttribute('data-journey-state')) === 'UNAVAILABLE' ? 0 : 1, 'one primary action per actionable item');
    }
    const support = page.locator('.flh-activity-card').filter({ hasText: 'تمرين تعلّم فقط' });
    assert.equal(await support.locator('[data-exam]').count(), 0, 'Learning-only support never forces Exam');
    assert.equal(await support.locator('[data-journey-primary]').getAttribute('data-result-attempt'), UUID(21));
    await overflow(page); fs.mkdirSync('playwright-screenshots', { recursive: true });
    await page.screenshot({ path: `playwright-screenshots/learner-journey-${device.name}.png`, fullPage: true });

    const catalogBefore = data.count('student-library-api', 'catalog');
    await page.locator('[data-learn="qa-continue"][data-journey-primary]').click();
    await page.locator('#flhConfirmAnswer').waitFor();
    assert.match(await page.locator('.question').innerText(), /النسخة الأصلية/);
    assert.equal(await page.locator('.flh-resume-note').count(), 1);
    await page.locator('.flh-learn-answer').first().click(); await page.locator('#flhConfirmAnswer').click();
    await page.locator('#flhLearnNext').click(); await page.locator('#learnHome').click();
    await page.locator('[data-open-program="0"]').waitFor(); await openUnit(page);
    assert.ok(data.count('student-library-api', 'catalog') > catalogBefore, 'return after completion reloads authoritative status without hash change');
    assert.equal(await card(page, 'qa-continue').locator('.flh-journey').getAttribute('data-journey-state'), 'START_EXAM');

    await page.locator('[data-exam="qa-exam-ready"][data-journey-primary]').click();
    await page.locator('#examExit').waitFor(); assert.match(await page.locator('.question').innerText(), /النسخة الأصلية/);
    await page.locator('#examExit').click(); await page.locator('[data-open-program="0"]').waitFor(); await openUnit(page);
    assert.match(await page.locator('[data-exam="qa-exam-ready"][data-journey-primary]').innerText(), /تابع الامتحان/);

    const startsBeforeReview = data.count('learning-api', 'start_quiz') + data.count('exam-v2-api', 'start_exam');
    await page.locator('.flh-activity-card').filter({ hasText: 'نشاط مكتمل' }).locator('[data-journey-primary]').click();
    await page.locator('#ahDetailBack').waitFor(); assert.match(await page.locator('.flh-history-review-list').innerText(), /طلب السؤال اختيار/);
    assert.equal(data.count('learning-api', 'start_quiz') + data.count('exam-v2-api', 'start_exam'), startsBeforeReview, 'result CTA reads history without a retake or submit');
    await page.locator('#ahDetailBack').click(); await page.locator('[data-nav="home"]').first().click();

    data.failCatalog(); await page.locator('#flhLibraryRefresh').click(); await page.locator('#flhLibraryRetry').waitFor();
    assert.equal(await page.locator('[data-journey-primary]').count(), 0, 'failed progress data cannot advertise NEW');
    await page.locator('#flhLibraryRetry').click(); await page.locator('[data-open-program="0"]').waitFor();

    data.delayCatalog(); await page.locator('#flhLibraryRefresh').click(); await data.captured;
    await page.evaluate(({ token, next }) => { localStorage.setItem('learner_session', token); state.learnerProfile = next; renderStudentHome(next); }, { token: B, next: profile(true) });
    await page.getByText('محتوى جلسة الاختبار الثانية', { exact: true }).waitFor(); data.release();
    await page.waitForFunction(() => !document.querySelector('[data-student-library]')?.textContent.includes('تابع نشاطك المحفوظ'));
    assert.equal(await page.locator('[data-journey-primary]').count(), 0, 'late previous session response cannot paint previous learner actions');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('محتوى جلسة الاختبار الثانية', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-learn="qa-continue"]').count(), 0, 'reload preserves new learner isolation');
    await overflow(page);
    assert.deepEqual(pageErrors, [], `${device.name}: no runtime errors`);
    assert.deepEqual(failedResponses, [{ path: '/functions/v1/student-library-api', status: 500 }], 'only injected backend failure is observed');
    console.log(`PASS learner journey ${device.name}: four states, unfinished ordering, bookless assignment, Learning-only completion, live launcher/resume, refreshed progress, read-only results, error retry and stale-session isolation`);
    await context.close();
  }
  fs.writeFileSync('playwright-screenshots/batch2-journey-manifest.json', JSON.stringify({ feature_id: 'FLH-FEAT-2026-024', spec_version: '1.1', head_sha: process.env.FLH_QA_HEAD_SHA || process.env.GITHUB_SHA || null, run_id: process.env.GITHUB_RUN_ID || null, source: 'isolated synthetic learner journey runtime', retention_days: 7, files: ['learner-journey-mobile.png', 'learner-journey-desktop.png'] }, null, 2));
} finally { await browser.close(); }
