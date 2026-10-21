import { launchMockQaBrowser } from './qa-isolation.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
      activity('qa-continue', 'تابع نشاطك المحفوظ — 19 - (-7)', learningDone ? 'START_EXAM' : 'CONTINUE_LEARNING'), activity('qa-exam-ready', 'جاهز للامتحان', 'START_EXAM'),
      activity('qa-support', 'تمرين تعلّم فقط', 'COMPLETE', { support_session: true, exam: { enabled: false } }), activity('qa-unavailable', 'نشاط يحتاج إتاحة', 'UNAVAILABLE')];
    return { programs: [{ id: 'p', title: 'منهاج الاختبار', program_type: 'curriculum', grade_level: 7, school_year: '2026/<img src=x onerror=alert(1)>', is_primary: true,
      books: [{ id: 'b', title: 'كتاب الاختبار', units: [{ id: 'u', title: 'وحدة الاختبار', quizzes: qs }], extras: [] }] }],
      standalone_books: [{id:'standalone',title:'كتاب مستقل للاختبار',units:[{title:'وحدة مستقلة',quizzes:[activity('qa-standalone','تمرين من كتاب مستقل','NEW')]}],extras:[activity('qa-extra','تدريب إضافي مستقل','NEW')]}],
      standalone_assessments: [qs[1], activity('qa-bookless-complete', 'نتيجة نشاط مستقل', 'COMPLETE'), activity('qa-bookless-new', 'نشاط مخصص دون كتاب', 'NEW')] };
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
        if (body.action === 'list_attempts') {
          if(second)return json(route,{items:[],has_more:false});
          const items=Array.from({length:7},(_,i)=>({id:UUID(21+i),delivery_mode:i%2?'learning':'exam',percentage:80+i,wrong_count:2,duration_seconds:30,submitted_at:`2026-10-${String(18-i).padStart(2,'0')}T11:00:00Z`,context:{quiz:{title:`محاولة اختبار سابقة ${i+1}`}}}));
          return json(route,{items:items.filter(x=>body.mode==='all'||x.delivery_mode===body.mode).slice(0,body.page_size),has_more:false});
        }
        assert.equal(body.action, 'attempt_detail');
        if(second)return json(route,{error:'ATTEMPT_NOT_FOUND'},403);
        assert.equal(body.attempt_id, UUID(21));
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

const openUnit = async page => { await page.locator('[data-open-program="0"]').click(); assert.equal(await page.locator('.flh-page-title img').count(),0,'school-year markup stays inert on program detail'); assert.ok((await page.locator('.flh-page-title small').textContent()).includes('<img'),'program subtitle escapes school-year metadata'); await page.locator('[data-book="0"]').click(); await page.locator('[data-unit="0"]').click(); };
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
    const dash=page.locator('[data-student-dashboard]');
    await page.locator('[data-attempt-history] .flh-attempt-card').first().waitFor();
    assert.equal(await page.locator('[data-attempt-history] .flh-attempt-card').count(),4,'original compact history keeps four attempts');
    assert.equal(await dash.locator('.flh-dashboard-hero [data-journey-primary]').count(),1);
    assert.equal(await dash.locator('.flh-dashboard-hero [data-learn]').getAttribute('data-learn'),'qa-continue');
    for(const title of [dash.locator('.flh-dashboard-hero h3'),dash.locator('[data-dashboard-task="qa-continue"] b')]){
      assert.equal(await title.locator('.flh-math-ltr').count(),1,'actual dashboard title uses shared renderer');
      assert.equal(await title.locator('.flh-math-ltr').textContent(),'19 - (-7)');
      assert.equal(await title.locator('.flh-math-ltr').evaluate(el=>getComputedStyle(el).direction),'ltr','math keeps logical order inside RTL Home');
    }
    assert.equal(await dash.locator('[data-dashboard-list] [data-dashboard-task]').count(),4,'default list is compact');
    await dash.locator('[data-dashboard-more]').click();
    const ids=await dash.locator('[data-dashboard-list] [data-dashboard-task]').evaluateAll(nodes=>nodes.map(n=>n.dataset.dashboardTask));
    assert.equal(ids.length,6,'pending covers all book, extra and dedicated paths');
    assert.equal(new Set(ids).size,ids.length,'duplicate program/standalone identity appears once');
    assert.equal(ids.includes('qa-unavailable'),false,'catalog membership alone is never homework');
    await dash.locator('[data-dashboard-more]').click();
    assert.equal(await dash.locator('[data-dashboard-list] [data-dashboard-task]').count(),4);
    for(const [key,count] of [['continue',1],['new',4],['exam',1]]){
      const chip=dash.locator(`.flh-dashboard-filters [data-dashboard-filter="${key}"]`);
      await chip.click();assert.equal(await chip.getAttribute('aria-pressed'),'true');
      assert.equal(await dash.locator('[data-dashboard-list] [data-dashboard-task]').count(),count);
      assert.equal(await dash.locator(`[data-dashboard-list] [data-dashboard-group="${key}"]`).count(),count);
    }
    await dash.locator('.flh-dashboard-meters [data-dashboard-filter="continue"]').click();
    assert.equal(await dash.locator('[data-dashboard-count]').innerText(),'1 من 1');
    await dash.locator('[data-dashboard-filter="all"]').click();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('[data-student-dashboard]')).direction),'rtl');
    assert.ok(await dash.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().height>=44)),'visible dashboard touch targets >=44px');
    await overflow(page);fs.mkdirSync('playwright-screenshots',{recursive:true});
    await page.screenshot({path:`playwright-screenshots/student-dashboard-${device.name}.png`,fullPage:true});
    await page.locator('#ahAll').click();await page.locator('[data-mode="learning"]').waitFor();
    await page.locator('[data-mode="learning"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.flh-attempt-card').length===3);
    assert.equal(await page.locator('.flh-attempt-mode.learning').count(),3,'Learning history filter preserved');
    await page.locator('[data-mode="exam"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.flh-attempt-card').length===4);
    assert.equal(await page.locator('.flh-attempt-mode.exam').count(),4,'Exam history filter preserved');
    await page.locator('[data-attempt]').first().click();await page.locator('#ahDetailBack').waitFor();
    assert.match(await page.locator('.flh-history-review-list').innerText(),/طلب السؤال اختيار/);
    await page.locator('#ahDetailBack').click();await page.locator('#ahBack').click();
    await page.locator('#ahAll').waitFor();
    assert.equal(await page.locator('.flh-library-card small img').count(),0,'unsafe school-year markup cannot create an element in the catalog');
    assert.ok((await page.locator('.flh-library-card small').first().textContent()).includes('<img'),'catalog school-year is escaped and remains literal text');
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
    await page.locator('[data-nav="home"]').first().click();
    await page.locator('.flh-dashboard-hero [data-learn="qa-continue"]').click();
    await page.locator('#flhConfirmAnswer').waitFor();
    assert.match(await page.locator('.question').innerText(), /النسخة الأصلية/);
    assert.equal(await page.locator('.flh-resume-note').count(), 1);
    await page.locator('.flh-learn-answer').first().click(); await page.locator('#flhConfirmAnswer').click();
    await page.locator('#flhLearnNext').click(); await page.locator('#learnHome').click();
    await page.locator('[data-open-program="0"]').waitFor();
    assert.equal(await page.locator('[data-dashboard-task="qa-continue"]').getAttribute('data-dashboard-group'),'exam','Home reloads current state after completing Learning');
    await openUnit(page);
    assert.ok(data.count('student-library-api', 'catalog') > catalogBefore, 'return after completion reloads authoritative status without hash change');
    assert.equal(await card(page, 'qa-continue').locator('.flh-journey').getAttribute('data-journey-state'), 'START_EXAM');

    await page.locator('[data-exam="qa-exam-ready"][data-journey-primary]').click();
    await page.locator('#examExit').waitFor(); assert.match(await page.locator('.question').innerText(), /النسخة الأصلية/);
    await page.locator('#examExit').click(); await page.locator('[data-open-program="0"]').waitFor();
    assert.equal(await page.locator('[data-dashboard-task="qa-exam-ready"]').getAttribute('data-dashboard-group'),'continue','open Exam belongs to continuation');
    assert.equal(await page.locator('.flh-dashboard-hero [data-exam]').getAttribute('data-exam'),'qa-exam-ready');
    await openUnit(page);
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
    await page.locator('#ahAll').waitFor();
    assert.equal(await page.locator('[data-attempt-history] .flh-attempt-card').count(),0,'second learner never receives first learner history');
    await page.waitForFunction(() => !document.querySelector('[data-student-library]')?.textContent.includes('تابع نشاطك المحفوظ'));
    assert.equal(await page.locator('[data-journey-primary]').count(), 0, 'late previous session response cannot paint previous learner actions');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('محتوى جلسة الاختبار الثانية', { exact: true }).waitFor();
    await page.locator('#ahAll').waitFor();
    assert.equal(await page.locator('[data-attempt-history] .flh-attempt-card').count(),0,'reload retains second learner history isolation');
    await page.evaluate(id=>window.FLH.openAttemptHistoryAttempt(id),UUID(21));
    await page.locator('[data-attempt-history] .error').waitFor();
    assert.equal(await page.locator('.flh-history-review-list').count(),0,'second session cannot review first session attempt');
    await page.locator('#ahDetailBack').click();await page.locator('#ahAll').waitFor();
    assert.equal(await page.locator('[data-learn="qa-continue"]').count(), 0, 'reload preserves new learner isolation');
    await page.evaluate(({token,next})=>{localStorage.setItem('learner_session',token);state.learnerProfile=next;renderStudentHome(next);},{token:A,next:profile()});
    await page.locator('.flh-dashboard-hero [data-exam="qa-exam-ready"]').waitFor();
    await page.locator('[data-attempt-history] .flh-attempt-card').first().waitFor();
    assert.equal(await page.locator('[data-attempt-history] .flh-attempt-card').count(),4,'reverse switch restores only first learner history');
    assert.equal(await page.getByText('محتوى جلسة الاختبار الثانية',{exact:true}).count(),0,'reverse switch clears second session');
    await overflow(page);
    assert.deepEqual(pageErrors, [], `${device.name}: no runtime errors`);
    assert.deepEqual(failedResponses, [{ path: '/functions/v1/student-library-api', status: 500 },{path:'/functions/v1/attempt-history-api',status:403}], 'only injected network failure and cross-session denial are observed');
    console.log(`PASS learner journey ${device.name}: four states, unfinished ordering, bookless assignment, Learning-only completion, live launcher/resume, refreshed progress, read-only results, error retry and stale-session isolation`);
    await context.close();
  }
  fs.writeFileSync('playwright-screenshots/batch2-journey-manifest.json', JSON.stringify({ feature_id: 'FLH-FEAT-2026-024', spec_version: '1.1', head_sha: process.env.FLH_QA_HEAD_SHA || process.env.GITHUB_SHA || null, run_id: process.env.GITHUB_RUN_ID || null, source: 'isolated synthetic learner journey runtime', retention_days: 7, files: ['learner-journey-mobile.png', 'learner-journey-desktop.png'] }, null, 2));
  const files=['student-dashboard-mobile.png','student-dashboard-desktop.png'];
  fs.writeFileSync('playwright-screenshots/student-dashboard-manifest.json',JSON.stringify({feature_id:'FLH-FEAT-2026-034',spec_version:'1.0',drive_revision_id:'2',head_sha:process.env.FLH_QA_HEAD_SHA||null,run_id:process.env.GITHUB_RUN_ID||null,run_attempt:process.env.GITHUB_RUN_ATTEMPT||null,source:'mock-local synthetic Testing APIs',retention_days:7,files:files.map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(`playwright-screenshots/${name}`)).digest('hex')}))},null,2));
} finally { await browser.close(); }
