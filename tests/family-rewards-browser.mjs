import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173/';
const OUTPUT_DIR = 'playwright-screenshots';
const LEARNER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-01T09:00:00Z';
const learner = { id: LEARNER_ID, slug: 'test', display_name: 'طالب الاختبار', grade_level: 7, is_test: true, avatar_emoji: '🧪' };
const clone = value => structuredClone(value);
const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

/** Isolated server fixtures exercise the real UI without touching any family data. */
export function createRewardsFixture() {
  const state = { learner_id: LEARNER_ID, xp: 100, reward_points: 20, current_level: 1, current_streak: 2, longest_streak: 3 };
  const catalog = { learners: [learner], states: [state], categories: [], rules: [], rewards: [], submissions: [], claims: [], ledger: [], breakdown: [], badges: [{ code: 'qa-consistency', title: 'استمرارية التعلّم', is_active: true }, { code: 'qa-effort', title: 'جهد مثمر', is_active: true }] };
  const calls = [];
  const results = new Map();
  let counter = 0;
  let failBefore = null;
  let failAfter = '';
  let delayAction = '';
  let delayedResolve;
  let delayPromise;
  const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const find = (rows, target) => rows.find(row => row.id === target);
  const pushEvent = (delta, reason, extra = {}) => {
    state.reward_points += delta;
    const event = {
      id: id(), learner_id: LEARNER_ID, event_type: 'family_behavior', reward_points_delta: delta,
      xp_delta: 0, reason, created_at: NOW, occurred_at: NOW, approved_at: NOW,
      source_type: 'family_behavior', metadata: { status: 'approved', base_points: delta, initiative_bonus_points: 0, requester_type: 'parent', requester_id: 'qa-parent', reviewer_id: 'qa-parent' },
      ...extra,
    };
    catalog.ledger.unshift(event);
    return event;
  };
  catalog.ledger.push({ id: id(), learner_id: LEARNER_ID, event_type: 'quiz_completed', reward_points_delta: 20, xp_delta: 100, source_type: 'quiz', source_id: 'qa-academic-attempt', reason: 'إكمال تدريب الاختبار', metadata: { status: 'approved' }, created_at: NOW });
  const snapshot = role => {
    const value = clone(catalog);
    value.ok = true;
    const breakdown = new Map();
    for (const row of catalog.ledger) {
      const key = `${row.metadata?.category_id || ''}:${row.source_type}`;
      if (!breakdown.has(key)) breakdown.set(key, { learner_id: LEARNER_ID, category_id: row.metadata?.category_id || null, category_title: row.metadata?.category_title || (row.source_type === 'quiz' ? 'التعلّم' : row.source_type === 'reward_claim' ? 'الجوائز' : 'تعديل موثّق'), source_type: row.source_type, points: 0 });
      breakdown.get(key).points += row.reward_points_delta;
    }
    value.breakdown = [...breakdown.values()];
    if (role === 'learner') {
      value.badges = [];
      value.rules = value.rules.filter(row => row.is_active && row.self_report_allowed);
      value.rewards = value.rewards.filter(row => row.is_active).map(row => ({
        ...row, eligible: state.reward_points >= row.required_reward_points && state.current_level >= (row.required_level || 1),
        ineligibility_reasons: state.reward_points < row.required_reward_points ? ['INSUFFICIENT_POINTS'] : [],
        progress: { points: state.reward_points, required_points: row.required_reward_points, level: state.current_level, required_level: row.required_level || 1, redemptions: 0 },
      }));
    }
    return value;
  };
  const mutate = body => {
    const action = body.action;
    if (action === 'category_save') {
      const row = find(catalog.categories, body.id) || { id: id() };
      Object.assign(row, body, { id: row.id });
      if (!catalog.categories.includes(row)) catalog.categories.push(row);
      return { category: clone(row), id: row.id };
    }
    if (action === 'rule_save' || action === 'reward_save') {
      const rows = action === 'rule_save' ? catalog.rules : catalog.rewards;
      const row = find(rows, body.id) || { id: id() };
      Object.assign(row, body, { id: row.id, category_title: find(catalog.categories, body.category_id)?.title });
      if (!rows.includes(row)) rows.push(row);
      return { [action === 'rule_save' ? 'rule' : 'reward']: clone(row), id: row.id };
    }
    if (action === 'behavior_record' || action === 'behavior_submit') {
      const rule = find(catalog.rules, body.rule_id);
      assert.ok(rule, 'behavior request references a configured rule');
      const row = {
        id: id(), learner_id: LEARNER_ID, rule_id: rule.id, category_id: rule.category_id,
        rule_title: rule.title, category_title: find(catalog.categories, rule.category_id)?.title,
        status: action === 'behavior_record' ? 'approved' : 'pending',
        base_points: action === 'behavior_record' ? rule.base_points : 0, initiative_bonus_points: action === 'behavior_record' && body.initiative ? rule.initiative_bonus_points : 0,
        reason: body.reason, occurred_at: body.occurred_at || NOW, requested_at: NOW, initiative: body.initiative,
        requester_type: action === 'behavior_record' ? 'parent' : 'learner', requester_id: 'qa-requester', reviewer_id: action === 'behavior_record' ? 'qa-parent' : null,
      };
      row.total_points = row.base_points + row.initiative_bonus_points;
      catalog.submissions.unshift(row);
      if (action === 'behavior_record') pushEvent(row.total_points, row.reason, { source_id: row.id, metadata: clone(row) });
      return { submission: clone(row), id: row.id };
    }
    if (action === 'behavior_review') {
      const row = find(catalog.submissions, body.submission_id);
      assert.ok(row, 'review references a pending submission');
      if (row.status === 'pending') {
        row.status = body.decision;
        if (row.status === 'approved') {
          const rule = find(catalog.rules, row.rule_id);
          row.base_points = rule.base_points;
          row.initiative_bonus_points = row.initiative ? rule.initiative_bonus_points : 0;
          row.total_points = row.base_points + row.initiative_bonus_points;
          pushEvent(row.total_points, row.reason, { source_id: row.id, metadata: { ...clone(row), reviewer_id: 'qa-parent', approved_at: NOW } });
        }
      }
      return { submission: clone(row) };
    }
    if (action === 'reward_request') {
      const reward = find(catalog.rewards, body.reward_id);
      if (!reward || state.reward_points < reward.required_reward_points) return { error: 'INSUFFICIENT_POINTS', status: 409 };
      const row = { id: id(), learner_id: LEARNER_ID, reward_id: reward.id, reward_title: reward.title, status: 'pending', requested_at: NOW, required_reward_points: reward.required_reward_points, metadata: { requested_points: reward.required_reward_points } };
      catalog.claims.unshift(row);
      return { claim: clone(row), id: row.id };
    }
    if (action === 'reward_review') {
      const row = find(catalog.claims, body.claim_id);
      assert.ok(row, 'review references a pending reward claim');
      if (row.status === 'pending') {
        row.status = body.decision;
        if (row.status === 'approved') {
          row.points_spent = row.required_reward_points;
          pushEvent(-row.required_reward_points, 'الموافقة على المكافأة', { event_type: 'reward_points_adjustment', source_type: 'reward_claim', source_id: row.id, metadata: { reward_title: row.reward_title, points_spent: row.required_reward_points, status: 'approved', reviewer_id: 'qa-parent' } });
        }
      }
      return { claim: clone(row) };
    }
    if (action === 'reward_redeem') {
      const row = find(catalog.claims, body.claim_id);
      assert.equal(row.status, 'approved');
      row.status = 'redeemed';
      return { claim: clone(row) };
    }
    if (action === 'points_adjust') return { event: pushEvent(body.delta, body.reason, { event_type: 'reward_points_adjustment', source_type: 'manual_adjustment', metadata: { actor_id: 'qa-parent', status: 'approved', reversal_event_id: body.reversal_event_id } }) };
    throw new Error(`Unexpected reward mutation: ${action}`);
  };
  return {
    catalog, state, calls,
    last: action => calls.filter(row => row.action === action).at(-1),
    count: action => calls.filter(row => row.action === action).length,
    failBefore: (action, error = 'INTERNAL_ERROR', status = 500, persistent = false) => { failBefore = { action, error, status, persistent }; },
    clearFailure: () => { failBefore = null; },
    failAfter: action => { failAfter = action; },
    delay: action => { delayAction = action; delayPromise = new Promise(resolve => { delayedResolve = resolve; }); },
    release: () => { delayedResolve?.(); delayAction = ''; },
    async handle(body) {
      const respond = (body, status = 200) => ({ body, status });
      calls.push(clone(body));
      const action = body.action;
      if (action === delayAction) await delayPromise;
      if (action === failBefore?.action) { const failure = failBefore; if (!failure.persistent) failBefore = null; return respond({ error: failure.error }, failure.status); }
      if (action === 'student_profile') return respond({ learner, gamification: { ...state, badges: [], rewards: catalog.rewards } });
      if (action === 'parent_dashboard') return respond({ parent: { id: 'qa-parent', relation: 'father', role: 'owner' }, learners: [learner], states: [state], attempts: [], reward_claims: catalog.claims });
      if (action === 'learner_choices') return respond({ learners: [learner] });
      if (action === 'student_login') return respond({ session: 'mock-rewards-testing-learner', profile: { learner, gamification: { ...state, badges: [], rewards: catalog.rewards } } });
      if (action === 'parent_rewards_dashboard' || action === 'student_rewards_dashboard') return respond(snapshot(action.startsWith('parent') ? 'parent' : 'learner'));
      if (action === 'parent_rewards_ledger' || action === 'student_rewards_ledger') {
        const ledger = catalog.ledger.filter(row => (!body.category_id || row.metadata?.category_id === body.category_id) && (!body.source_type || row.source_type === body.source_type));
        return respond({ ledger: clone(ledger), next_cursor: null });
      }
      const key = `${action}:${body.idempotency_key || ''}`;
      const result = results.has(key) && body.idempotency_key ? results.get(key) : mutate(body);
      if (body.idempotency_key) results.set(key, clone(result));
      if (action === failAfter) { failAfter = ''; return respond({ error: 'INTERNAL_ERROR' }, 500); }
      return respond({ ok: !result.error, ...result }, result.error ? result.status || 400 : 200);
    },
  };
}

async function open(page, role, ready = true) {
  await page.evaluate(roleName => {
    localStorage.removeItem('learner_session');
    localStorage.removeItem('parent_session');
    if (roleName === 'parent') localStorage.setItem('parent_session', JSON.stringify({ access_token: 'mock-rewards-parent' }));
    else localStorage.setItem('learner_session', 'mock-rewards-testing-learner');
  }, role);
  await page.goto(`${APP_URL}?rewards-qa=${role}#${role === 'parent' ? 'parent' : 'student'}-rewards`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-family-rewards][data-role="${role === 'parent' ? 'parent' : 'student'}"]`).waitFor({ state: 'visible' });
  if (ready) await page.locator('[data-fr-balance]').waitFor({ state: 'visible' });
}

async function showForm(page, selector) {
  const form = page.locator(selector);
  if (!(await form.isVisible())) await form.locator('xpath=ancestor::details[1]').locator('summary').first().click();
  await form.waitFor({ state: 'visible' });
  return form;
}

const responseFor = (page, action) => page.waitForResponse(response => {
  if (!response.url().includes('/functions/v1/family-api')) return false;
  try { return response.request().postDataJSON()?.action === action; } catch { return false; }
});

async function perform(page, action, trigger, { status = 200, refresh = true } = {}) {
  const response = responseFor(page, action);
  const role = await page.locator('[data-family-rewards]').getAttribute('data-role');
  const dashboard = refresh ? responseFor(page, `${role}_rewards_dashboard`) : null;
  await trigger();
  assert.equal((await response).status(), status, `${action}: expected server status`);
  if (dashboard) {
    assert.equal((await dashboard).status(), 200, `${action}: refreshed authoritative catalog`);
    await page.waitForFunction(() => !document.querySelector('[data-family-rewards] [aria-busy="true"]'));
  } else if (status >= 400) await page.locator('[data-family-rewards] [role="alert"]').first().waitFor({ state: 'visible' });
  else await page.waitForFunction(() => !document.querySelector('[data-family-rewards] [aria-busy="true"]'));
}

const submit = (page, selector) => page.locator(`${selector} button[type="submit"]`).click();
const balance = (page, value) => page.locator('[data-fr-balance]').filter({ hasText: new RegExp(`^${value}$`) }).waitFor({ state: 'visible' });

async function assertLayout(page, label) {
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl', `${label}: Arabic shell remains RTL`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no horizontal page overflow`);
  const unlabeled = await page.locator('[data-family-rewards] input:not([type="hidden"]), [data-family-rewards] select, [data-family-rewards] textarea').evaluateAll(elements => elements.filter(element => !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map(element => element.id));
  assert.deepEqual(unlabeled, [], `${label}: every input has an accessible label`);
  const rootText = await page.locator('[data-family-rewards]').innerText();
  assert.doesNotMatch(rootText, /لوحة الصدارة|ترتيب الإخوة|الفائز|الخاسر|leaderboard/i, `${label}: no sibling ranking`);
  const buttons = await page.locator('[data-family-rewards] .btn').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height > 0).map(element => ({ text: element.textContent.trim(), height: element.getBoundingClientRect().height })));
  assert.ok(buttons.every(button => button.height >= 40), `${label}: touch actions are at least 40px high`);
}

async function screenshot(page, name, target = page) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (target === page) await page.screenshot({ path: `${OUTPUT_DIR}/${name}.png`, fullPage: true });
  else await target.screenshot({ path: `${OUTPUT_DIR}/${name}.png` });
}

async function runBrowserSuite() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
  for (const device of [{ name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { name: 'desktop', viewport: { width: 1365, height: 900 } }]) {
    const { name, ...contextOptions } = device;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const server = createRewardsFixture();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/functions/v1/family-api', async route => {
      const result = await server.handle(route.request().postDataJSON() || {});
      return json(route, result.body, result.status);
    });
    await page.route('**/functions/v1/student-library-api', route => json(route, { programs: [], standalone_books: [] }));
    await page.route('**/functions/v1/activity-api', route => json(route, { ok: true }));
    await page.route('**/functions/v1/question-reference-api', route => json(route, { codes: {} }));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    // Loading, empty and permission states are distinct and recover without a login reset.
    server.delay('parent_rewards_dashboard');
    await open(page, 'parent', false);
    await page.locator('[data-family-rewards] .loading-card').waitFor({ state: 'visible' });
    server.release();
    await balance(page, 20);
    await open(page, 'student');
    await page.getByText('لم يضف الأهل جوائز متاحة لك بعد.', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#frSelfReportRule option').count(), 1, 'no unconfigured self-report behavior is offered');
    assert.equal(await page.locator('#frAdjustmentForm').count(), 0, 'learner has no point-adjustment controls');
    assert.equal(await page.locator('#frRewardForm').count(), 0, 'learner has no reward-management controls');
    await assertLayout(page, `${device.name} empty learner`);
    server.failBefore('parent_rewards_dashboard', 'PARENT_MANAGEMENT_REQUIRED', 403, true);
    await open(page, 'parent', false);
    await page.getByRole('alert').filter({ hasText: 'متاحة لمالك العائلة' }).waitFor({ state: 'visible' });
    server.clearFailure();
    await page.locator('[data-fr-retry]').click();
    await balance(page, 20);

    // Category and rule management uses explicit editable scope and all contract fields.
    await showForm(page, '#frCategoryForm');
    await page.locator('#frCategoryTitle').fill('المساهمة في البيت');
    await page.locator('#frCategoryDescription').fill('مساهمة تختارها العائلة');
    await perform(page, 'category_save', () => page.locator('#frCategoryTitle').press('Enter'));
    const categoryId = server.catalog.categories[0].id;
    await showForm(page, '#frCategoryForm');
    await page.locator(`[data-fr-category="${categoryId}"]`).filter({ hasText: 'المساهمة في البيت' }).waitFor({ state: 'visible' });
    await page.locator(`[data-fr-edit-category="${categoryId}"]`).click();
    await page.locator('#frCategoryTitle').fill('مساهمة العائلة');
    await perform(page, 'category_save', () => submit(page, '#frCategoryForm'));
    assert.equal(server.last('category_save').id, categoryId, 'editing preserves the category identity');
    await showForm(page, '#frCategoryForm');
    await perform(page, 'category_save', () => page.locator(`[data-fr-toggle-category="${categoryId}"]`).click());
    assert.equal(server.catalog.categories[0].is_active, false, 'category can be deactivated');
    await showForm(page, '#frCategoryForm');
    await perform(page, 'category_save', () => page.locator(`[data-fr-toggle-category="${categoryId}"]`).click());

    await showForm(page, '#frRuleForm');
    await page.locator('#frRuleTitle').fill('ترتيب الغرفة');
    await page.locator('#frRuleDescription').fill('ترتيب الأشياء بعد استخدامها');
    await page.locator('#frRuleCategory').selectOption(categoryId);
    await page.locator('#frRuleBase').fill('5');
    await page.locator('#frRuleBonus').fill('3');
    await page.locator('#frRuleScope').selectOption('selected');
    await page.locator(`#frRuleForm [name="learner_ids"][value="${LEARNER_ID}"]`).check();
    await page.locator('#frRuleCadence').selectOption('week');
    await page.locator('#frRuleLimit').fill('3');
    await page.locator('#frRuleSelfReport').check();
    await screenshot(page, `family-rewards-${device.name}-rule-form`, page.locator('#frRuleForm'));
    await perform(page, 'rule_save', () => submit(page, '#frRuleForm'));
    const ruleId = server.catalog.rules[0].id;
    const rulePayload = server.last('rule_save');
    assert.deepEqual({ category_id: rulePayload.category_id, base_points: rulePayload.base_points, initiative_bonus_points: rulePayload.initiative_bonus_points, learner_scope: rulePayload.learner_scope, learner_ids: rulePayload.learner_ids, cadence: rulePayload.cadence, max_awards: rulePayload.max_awards, self_report_allowed: rulePayload.self_report_allowed, parent_approval_required: rulePayload.parent_approval_required, is_active: rulePayload.is_active }, { category_id: categoryId, base_points: 5, initiative_bonus_points: 3, learner_scope: 'selected', learner_ids: [LEARNER_ID], cadence: 'week', max_awards: 3, self_report_allowed: true, parent_approval_required: true, is_active: true });
    await showForm(page, '#frRuleForm');
    await page.locator(`[data-fr-edit-rule="${ruleId}"]`).click();
    await page.locator('#frRuleTitle').fill('ترتيب الغرفة باهتمام');
    await page.locator('#frRuleCadence').selectOption('unlimited');
    assert.equal(await page.locator('#frRuleLimit').isDisabled(), true, 'unlimited cadence has no required numeric limit');
    await page.locator('#frRuleCadence').selectOption('day');
    await page.locator('#frRuleLimit').fill('1');
    await perform(page, 'rule_save', () => submit(page, '#frRuleForm'));
    await showForm(page, '#frRuleForm');
    await perform(page, 'rule_save', () => page.locator(`[data-fr-toggle-rule="${ruleId}"]`).click());
    assert.equal(server.catalog.rules[0].is_active, false, 'rule can be deactivated');
    await open(page, 'student');
    assert.equal(await page.locator(`#frSelfReportRule option[value="${ruleId}"]`).count(), 0, 'inactive rules are absent from learner self-report choices');
    await open(page, 'parent');
    await showForm(page, '#frRuleForm');
    await perform(page, 'rule_save', () => page.locator(`[data-fr-toggle-rule="${ruleId}"]`).click());

    // A lost post-commit response leaves the local balance unchanged; the retry reconciles once.
    await page.locator('#frOccurrenceLearner').selectOption(LEARNER_ID);
    await page.locator('#frOccurrenceRule').selectOption(ruleId);
    await page.locator('#frOccurrenceInitiative').check();
    await page.locator('#frOccurrenceAt').fill('2026-10-01T12:00');
    await page.locator('#frOccurrenceReason').fill('رتّب الغرفة دون تذكير');
    server.failAfter('behavior_record');
    await perform(page, 'behavior_record', () => submit(page, '#frOccurrenceForm'), { status: 500, refresh: false });
    await balance(page, 20);
    const retryKey = server.last('behavior_record').idempotency_key;
    assert.match(retryKey, /^[0-9a-f-]{36}$/i, 'occurrence has a durable retry key');
    await perform(page, 'behavior_record', () => submit(page, '#frOccurrenceForm'));
    assert.equal(server.last('behavior_record').idempotency_key, retryKey, 'retry reuses the original key after a lost response');
    await balance(page, 28);
    assert.equal(server.catalog.ledger.length, 2, 'post-commit retry adds one award alongside academic points');
    assert.equal(server.state.xp, 100, 'behavior fixture does not alter academic XP');
    const directEvent = server.catalog.ledger[0];
    const directHistory = page.locator(`[data-fr-event="${directEvent.id}"]`);
    await directHistory.filter({ hasText: 'رتّب الغرفة دون تذكير' }).waitFor({ state: 'visible' });
    assert.match(await directHistory.innerText(), /أساس.*5.*مبادرة.*3/s, 'ledger explains base and initiative separately');
    await directHistory.locator('summary').click();
    assert.match(await directHistory.innerText(), /ولي الأمر/, 'ledger identifies the actor for family points');

    // Self-report never awards locally and never submits a client-controlled learner identity.
    await open(page, 'student');
    await page.locator('#frSelfReportRule').selectOption(ruleId);
    await page.locator('#frSelfReportInitiative').check();
    await page.locator('#frSelfReportAt').fill('2026-10-02T12:00');
    await page.locator('#frSelfReportReason').fill('بادرت بترتيب الغرفة');
    await perform(page, 'behavior_submit', () => submit(page, '#frSelfReportForm'));
    assert.equal('learner_id' in server.last('behavior_submit'), false, 'self-report identity is session-derived');
    await balance(page, 28);
    const pendingId = server.catalog.submissions[0].id;
    await page.getByText('سلوكياتك وطلبات جوائزك', { exact: true }).click();
    const pendingRow = page.locator(`[data-fr-submission="${pendingId}"]`).first();
    assert.match(await pendingRow.innerText(), /بانتظار موافقة الأهل/, 'learner sees pending approval state');
    assert.equal(await pendingRow.locator('button').count(), 0, 'learner cannot approve their own report');
    await screenshot(page, `family-rewards-${device.name}-pending`, pendingRow);
    await assertLayout(page, `${device.name} pending learner`);

    // In-flight approval accepts one action and shows the server result rather than optimistic points.
    await open(page, 'parent');
    await page.locator('#frReviewReason').fill('مبادرة موفّقة');
    const approval = page.locator(`[data-fr-behavior-approve="${pendingId}"]`).first();
    const reviewResponse = responseFor(page, 'behavior_review');
    const reviewDashboard = responseFor(page, 'parent_rewards_dashboard');
    const reviewCount = server.count('behavior_review');
    server.delay('behavior_review');
    await approval.evaluate(button => { button.click(); button.click(); });
    await approval.locator('xpath=..').locator('[aria-busy="true"]').waitFor({ state: 'attached' });
    assert.equal(await approval.isDisabled(), true, 'approval disables during the request');
    assert.equal(server.count('behavior_review'), reviewCount + 1, 'double action sends one approval request');
    await balance(page, 28);
    server.release();
    assert.equal((await reviewResponse).status(), 200);
    await reviewDashboard;
    await balance(page, 36);
    assert.equal(server.catalog.ledger.length, 3, 'approval shows one new award');

    // Rejection and cadence errors show a clear result and preserve the balance.
    await open(page, 'student');
    await page.locator('#frSelfReportRule').selectOption(ruleId);
    await page.locator('#frSelfReportAt').fill('2026-10-03T12:00');
    await page.locator('#frSelfReportReason').fill('طلب يحتاج مراجعة');
    await perform(page, 'behavior_submit', () => submit(page, '#frSelfReportForm'));
    const rejectedId = server.catalog.submissions[0].id;
    await open(page, 'parent');
    await perform(page, 'behavior_review', () => page.locator(`[data-fr-behavior-reject="${rejectedId}"]`).first().click());
    await balance(page, 36);
    assert.equal(server.catalog.ledger.length, 3, 'rejection has no point movement');
    await open(page, 'student');
    await page.locator('#frSelfReportRule').selectOption(ruleId);
    server.failBefore('behavior_submit', 'CADENCE_LIMIT_REACHED', 409);
    await perform(page, 'behavior_submit', () => submit(page, '#frSelfReportForm'), { status: 409, refresh: false });
    await page.getByRole('alert').filter({ hasText: 'حد التكرار' }).waitFor({ state: 'visible' });
    await balance(page, 36);

    // Real-world reward management preserves criteria, learner scope, availability and limits.
    await open(page, 'parent');
    await showForm(page, '#frRewardForm');
    await page.locator('#frRewardTitle').fill('وقت لعبة عائلية');
    await page.locator('#frRewardDescription').fill('نشاط نختاره معًا');
    await page.locator('#frRewardType').selectOption('activity');
    await page.locator('#frRewardPoints').fill('10');
    await page.locator('#frRewardLevel').fill('1');
    await page.locator('#frRewardScope').selectOption('selected');
    await page.locator(`#frRewardForm [name="learner_ids"][value="${LEARNER_ID}"]`).check();
    await page.locator('#frRewardFrom').fill('2026-10-01T00:00');
    await page.locator('#frRewardUntil').fill('2027-01-01T00:00');
    await page.locator('#frRewardLimit').fill('3');
    await page.locator('#frRewardStreak').fill('2');
    await page.locator('#frRewardLongestStreak').fill('3');
    await page.locator('#frRewardXp').fill('100');
    await page.locator('#frRewardBadges [value="qa-consistency"]').check();
    await page.locator('#frRewardBadges [value="qa-effort"]').check();
    await screenshot(page, `family-rewards-${device.name}-reward-form`, page.locator('#frRewardForm'));
    await perform(page, 'reward_save', () => submit(page, '#frRewardForm'));
    const rewardId = server.catalog.rewards[0].id;
    const rewardPayload = server.last('reward_save');
    assert.deepEqual(rewardPayload.criteria, { current_streak: 2, longest_streak: 3, min_xp: 100, required_badge_codes: ['qa-consistency', 'qa-effort'] });
    assert.deepEqual(rewardPayload.learner_ids, [LEARNER_ID]);
    assert.equal(rewardPayload.max_redemptions_per_learner, 3);
    assert.ok(rewardPayload.available_from && rewardPayload.available_until, 'availability is submitted to the server');
    server.catalog.badges.find(row => row.code === 'qa-effort').is_active = false;
    await open(page, 'parent');
    await showForm(page, '#frRewardForm');
    await page.locator(`[data-fr-edit-reward="${rewardId}"]`).click();
    await page.locator('#frRewardTitle').fill('لعبة عائلية ممتعة');
    assert.equal(await page.locator('#frRewardBadges [value="qa-effort"]').isChecked(), true, 'an inactive required badge remains selected when editing');
    await perform(page, 'reward_save', () => submit(page, '#frRewardForm'));
    assert.deepEqual(server.last('reward_save').criteria.required_badge_codes, ['qa-consistency', 'qa-effort'], 'editing the title preserves inactive badge criteria');
    await showForm(page, '#frRewardForm');
    await perform(page, 'reward_save', () => page.locator(`[data-fr-toggle-reward="${rewardId}"]`).click());
    await open(page, 'student');
    assert.equal(await page.locator(`[data-fr-request-reward="${rewardId}"]`).count(), 0, 'inactive reward is unavailable to learner');
    await open(page, 'parent');
    await showForm(page, '#frRewardForm');
    await perform(page, 'reward_save', () => page.locator(`[data-fr-toggle-reward="${rewardId}"]`).click());

    // A stale eligibility decision still shows the server refusal; requesting does not spend.
    await open(page, 'student');
    const requestButton = page.locator(`[data-fr-request-reward="${rewardId}"]`);
    server.failBefore('reward_request', 'INSUFFICIENT_POINTS', 409);
    await perform(page, 'reward_request', () => requestButton.click(), { status: 409, refresh: false });
    await page.getByRole('alert').filter({ hasText: 'رصيد النقاط غير كافٍ' }).waitFor({ state: 'visible' });
    const claimRetryKey = server.last('reward_request').idempotency_key;
    await balance(page, 36);
    await perform(page, 'reward_request', () => requestButton.click());
    assert.equal(server.last('reward_request').idempotency_key, claimRetryKey, 'reward request retry retains its key');
    assert.equal('learner_id' in server.last('reward_request'), false, 'reward request identity is session-derived');
    await balance(page, 36);
    const claimId = server.catalog.claims[0].id;
    await open(page, 'parent');
    await perform(page, 'reward_review', () => page.locator(`[data-fr-claim-approve="${claimId}"]`).first().click());
    await balance(page, 26);
    assert.equal(server.catalog.ledger.filter(row => row.source_type === 'reward_claim').length, 1, 'approval adds one spend event');
    await perform(page, 'reward_redeem', () => page.locator(`[data-fr-claim-redeem="${claimId}"]`).first().click());
    await balance(page, 26);
    assert.equal(server.catalog.ledger.filter(row => row.source_type === 'reward_claim').length, 1, 'delivery does not display a second spend');
    await open(page, 'student');
    await perform(page, 'reward_request', () => page.locator(`[data-fr-request-reward="${rewardId}"]`).click());
    const rejectedClaimId = server.catalog.claims[0].id;
    await open(page, 'parent');
    await perform(page, 'reward_review', () => page.locator(`[data-fr-claim-reject="${rejectedClaimId}"]`).first().click());
    await balance(page, 26);

    // Adjustments require a reason and appear as a new, isolated negative ledger movement.
    await showForm(page, '#frAdjustmentForm');
    await page.locator('#frAdjustmentLearner').selectOption(LEARNER_ID);
    await page.locator('#frAdjustmentDelta').fill('-2');
    const adjustmentCount = server.count('points_adjust');
    await submit(page, '#frAdjustmentForm');
    assert.equal(server.count('points_adjust'), adjustmentCount, 'blank reason blocks an adjustment before transport');
    await page.locator('#frAdjustmentReason').fill('تصحيح موثّق <b>للسجل</b>');
    await perform(page, 'points_adjust', () => submit(page, '#frAdjustmentForm'));
    await balance(page, 24);
    assert.equal(server.catalog.ledger.length, 5, 'adjustment appends a compensating event');
    const adjustment = page.locator(`[data-fr-event="${server.catalog.ledger[0].id}"]`);
    await adjustment.filter({ hasText: 'تصحيح موثّق <b>للسجل</b>' }).waitFor({ state: 'visible' });
    assert.equal(await adjustment.locator('p b').count(), 0, 'free-text reasons remain escaped');
    const negative = adjustment.locator('bdi').filter({ hasText: /^-2$/ }).first();
    assert.deepEqual(await negative.evaluate(element => ({ direction: getComputedStyle(element).direction, bidi: getComputedStyle(element).unicodeBidi })), { direction: 'ltr', bidi: 'isolate' }, 'negative point amount preserves logical LTR sign');

    // Category/source drill-down invokes the server ledger boundary with explicit filters.
    await perform(page, 'parent_rewards_ledger', () => page.locator(`[data-fr-breakdown-category="${categoryId}"]`).click(), { refresh: false });
    assert.equal(server.last('parent_rewards_ledger').category_id, categoryId);
    assert.equal(server.last('parent_rewards_ledger').source_type, 'family_behavior');
    assert.equal(server.last('parent_rewards_ledger').learner_id, LEARNER_ID);
    await assertLayout(page, `${device.name} completed parent`);
    await screenshot(page, `family-rewards-${device.name}-parent`);
    await open(page, 'student');
    await balance(page, 24);
    await page.locator('[data-fr-ledger-all]').click();
    assert.equal('learner_id' in server.last('student_rewards_ledger'), false, 'learner ledger cannot select a sibling identity');
    assert.equal(await page.locator('[data-fr-behavior-approve], [data-fr-claim-approve], #frCategoryForm').count(), 0, 'learner history offers no management controls');
    await assertLayout(page, `${device.name} completed learner`);
    await screenshot(page, `family-rewards-${device.name}-student`);

    assert.deepEqual(errors, [], `${device.name}: no uncaught errors`);
    await context.close();
  }
  fs.writeFileSync(`${OUTPUT_DIR}/family-rewards-manifest.json`, JSON.stringify({ feature_id: 'FLH-FEAT-2026-010', spec_version: '1.0', drive_revision_id: '3', source: 'isolated mocked Testing-learner browser regression', head_sha: process.env.GITHUB_SHA || null, run_id: process.env.GITHUB_RUN_ID || null, retention_days: 7, files: ['mobile', 'desktop'].flatMap(device => ['parent', 'student', 'rule-form', 'reward-form', 'pending'].map(state => `family-rewards-${device}-${state}.png`)) }, null, 2));
  console.log('Family rewards browser regression passed for mobile and desktop using isolated Testing-learner fixtures.');
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runBrowserSuite();
