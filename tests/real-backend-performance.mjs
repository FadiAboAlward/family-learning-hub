import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const SUPABASE_URL = 'https://gkpoylfozvuwuwqeoduc.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_-ysUtue-9LpsJ8gabyrQaA_IaUf4F0W';
const QA_AUTH_URL = `${SUPABASE_URL}/functions/v1/qa-auth`;
const QA_QUIZ_SLUG = 'qa-automation-core';
const QA_PROGRAM_TITLE = 'QA Automation — Testing';
const QA_BOOK_TITLE = 'QA Automation Book';
const QA_QUESTION_COUNT = 3;
const APP_URL = process.env.APP_URL || 'http://localhost:4173/';
const REGIONS = { default: null, 'ap-southeast-1': 'ap-southeast-1' };

export function parseSampleCount(value = '10') {
  if (value === undefined || value === null || value === '') return 10;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 5) {
    throw new Error('PERF_SAMPLE_COUNT must be an integer of at least 5');
  }
  return count;
}

export function parseBrowserRunCount(value = '3') {
  if (value === undefined || value === null || value === '') return 3;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 3) {
    throw new Error('PERF_BROWSER_RUN_COUNT must be an integer of at least 3');
  }
  return count;
}

export function parseFiniteHeader(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function observeRejection(promise) {
  promise.catch(() => {});
  return promise;
}

export function isLearningFinishAction(text) {
  return String(text || '').trim() === 'إنهاء التدريب';
}

const SAMPLE_COUNT = parseSampleCount(process.env.PERF_SAMPLE_COUNT);
const BROWSER_RUN_COUNT = parseBrowserRunCount(process.env.PERF_BROWSER_RUN_COUNT);

function round(value) {
  return Math.round(Number(value) * 10) / 10;
}

function quantile(sorted, percentile) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]);
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}

export function summarizeSamples(samples, field = 'network_ms') {
  const values = samples.filter(sample => sample.ok && Number.isFinite(sample[field])).map(sample => sample[field]).sort((a, b) => a - b);
  return {
    p50_ms: quantile(values, 0.5),
    p75_ms: quantile(values, 0.75),
    p95_ms: quantile(values, 0.95),
    min_ms: values.length ? round(values[0]) : null,
    max_ms: values.length ? round(values.at(-1)) : null,
    sample_count: values.length,
    failures: samples.length - values.length,
  };
}

export function parseServerTiming(value) {
  if (!value) return [];
  return value.split(',').map(item => {
    const match = item.trim().match(/^([a-z][a-z0-9_.-]*);dur=([0-9.]+)(?:;desc="(sequential|parallel):([0-9]+)")?$/);
    return match ? { name: match[1], duration_ms: Number(match[2]), execution: match[3] || null, db_operations: match[4] ? Number(match[4]) : null } : null;
  }).filter(Boolean);
}

export function correlateUiTiming(actionStarted, uiReady, request = null) {
  const uiWait = Math.max(0, uiReady - actionStarted);
  if (!request) {
    return {
      ui_wait_ms: round(uiWait),
      frontend_only_ms: round(uiWait),
      request_start_offset_ms: null,
      request_started_before_checkpoint_ms: null,
      request_network_ms: null,
      backend_ms: null,
      network_transport_ms: null,
      post_response_render_ms: null,
      ui_ready_before_response_ms: null,
      database_operations: null,
      correlation_id: null,
      edge_region: null,
    };
  }
  const overlapStart = Math.max(actionStarted, request.started_at);
  const overlapEnd = Math.min(uiReady, request.response_at);
  const networkOverlap = Math.max(0, overlapEnd - overlapStart);
  const backend = parseFiniteHeader(request.backend_ms);
  return {
    ui_wait_ms: round(uiWait),
    frontend_only_ms: round(Math.max(0, uiWait - networkOverlap)),
    request_start_offset_ms: request.started_at >= actionStarted ? round(request.started_at - actionStarted) : null,
    request_started_before_checkpoint_ms: request.started_at < actionStarted ? round(actionStarted - request.started_at) : null,
    request_network_ms: round(request.response_at - request.started_at),
    backend_ms: backend,
    network_transport_ms: backend === null ? null : round(Math.max(0, request.response_at - request.started_at - backend)),
    post_response_render_ms: uiReady >= request.response_at ? round(uiReady - request.response_at) : null,
    ui_ready_before_response_ms: uiReady < request.response_at ? round(request.response_at - uiReady) : null,
    database_operations: parseFiniteHeader(request.database_operations),
    correlation_id: request.correlation_id || null,
    edge_region: request.edge_region || null,
  };
}

async function githubOidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('GitHub OIDC environment is unavailable');
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}audience=family-learning-hub-qa`, { headers: { Authorization: `Bearer ${bearer}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.value) throw new Error(`GitHub OIDC request failed: ${response.status}`);
  return payload.value;
}

async function requestQaAuth(action, runId = null) {
  const response = await fetch(QA_AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oidc_token: await githubOidcToken(), action, ...(runId ? { run_id: runId } : {}) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`QA auth ${action} failed: ${response.status} ${payload.error || ''}`.trim());
  return payload;
}

async function prepareQaRun() {
  const prepared = await requestQaAuth('prepare');
  if (prepared.learner?.slug !== 'test' || prepared.quiz_slug !== QA_QUIZ_SLUG || !prepared.session || !prepared.run_id) {
    throw new Error('QA auth did not return the canonical Testing learner boundary');
  }
  return prepared;
}

async function withQaRun(run) {
  const prepared = await prepareQaRun();
  let primaryError = null;
  try {
    return await run(prepared);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await requestQaAuth('cleanup', prepared.run_id);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      console.error(`Testing cleanup also failed: ${cleanupError.message}`);
    }
  }
}

function functionHeaders(session, region) {
  return {
    'content-type': 'application/json',
    apikey: PUBLISHABLE_KEY,
    ...(session ? { authorization: `Bearer ${session}` } : {}),
    ...(region ? { 'x-region': region } : {}),
  };
}

async function invoke(functionName, body, { session = null, region = null } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: functionHeaders(session, region),
      body: JSON.stringify(body),
    });
    const responseReceived = performance.now();
    const text = await response.text();
    const payloadReady = performance.now();
    const payload = JSON.parse(text || '{}');
    const sample = {
      ok: response.ok,
      http_status: response.status,
      network_ms: round(responseReceived - started),
      payload_ready_ms: round(payloadReady - started),
      response_parse_ms: round(payloadReady - responseReceived),
      backend_ms: parseFiniteHeader(response.headers.get('x-flh-backend-ms')),
      database_operations: parseFiniteHeader(response.headers.get('x-flh-db-operations')),
      edge_region: response.headers.get('x-flh-edge-region') || response.headers.get('x-sb-edge-region') || null,
      correlation_id: response.headers.get('x-flh-correlation-id') || null,
      phases: parseServerTiming(response.headers.get('server-timing')).filter(item => item.name !== 'total'),
    };
    return { payload, sample };
  } catch {
    return { payload: {}, sample: { ok: false, http_status: null, network_ms: null, payload_ready_ms: null, response_parse_ms: null, backend_ms: null, database_operations: null, edge_region: null, correlation_id: null, phases: [] } };
  }
}

function requireOk(result, label) {
  if (!result.sample.ok) throw new Error(`${label} failed with status ${result.sample.http_status ?? 'network'}`);
  return result;
}

async function completeLearningAttempt(session, started, firstAnswer) {
  const queue = [...(started.payload.queue || [])];
  let firstAnswerResult = firstAnswer;
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    let result = index === 0 && firstAnswerResult ? firstAnswerResult : null;
    for (let attempt = result ? 1 : 0; attempt < 4 && !result?.payload?.finalized; attempt++) {
      result = requireOk(await invoke('learning-api', { action: 'answer', attempt_id: started.payload.attempt_id, question_id: item.question_id, option_position: 1 }, { session }), 'Learning answer');
      if (result.payload.remediation_added) queue.push(result.payload.remediation_added);
    }
    if (!result?.payload?.finalized) throw new Error('Learning QA question did not finalize within its configured attempt limit');
  }
}

async function fullBaseline() {
  return withQaRun(async prepared => {
    const session = prepared.session;
    const choices = requireOk(await invoke('family-api', { action: 'learner_choices' }), 'Learner choices');
    const library = requireOk(await invoke('student-library-api', { action: 'catalog' }, { session }), 'Library');
    const learningStart = requireOk(await invoke('learning-api', { action: 'start_quiz', quiz_slug: QA_QUIZ_SLUG }, { session }), 'Learning start');
    const first = learningStart.payload.queue?.find(item => item.status === 'active') || learningStart.payload.queue?.[0];
    if (!first) throw new Error('Learning start returned no first question');
    const draft = requireOk(await invoke('learning-api', { action: 'save_draft', attempt_id: learningStart.payload.attempt_id, question_id: first.question_id, option_position: 1 }, { session }), 'Learning draft');
    const answer = requireOk(await invoke('learning-api', { action: 'answer', attempt_id: learningStart.payload.attempt_id, question_id: first.question_id, option_position: 1 }, { session }), 'Learning answer');
    await completeLearningAttempt(session, learningStart, answer);
    const finish = requireOk(await invoke('learning-api', { action: 'finish_quiz', attempt_id: learningStart.payload.attempt_id, duration_seconds: 1 }, { session }), 'Learning finish');
    const profile = requireOk(await invoke('family-api', { action: 'student_profile' }, { session }), 'Profile refresh');
    const examStart = requireOk(await invoke('exam-v2-api', { action: 'start_exam', quiz_slug: QA_QUIZ_SLUG }, { session }), 'Exam start');
    let examSave = null;
    for (const question of examStart.payload.questions || []) {
      const saved = requireOk(await invoke('exam-v2-api', { action: 'save_answer', attempt_id: examStart.payload.attempt_id, question_id: question.question_id, option_position: 1 }, { session }), 'Exam save');
      if (!examSave) examSave = saved;
    }
    if (!examSave) throw new Error('Exam start returned no questions');
    const examSubmit = requireOk(await invoke('exam-v2-api', { action: 'submit_exam', attempt_id: examStart.payload.attempt_id }, { session }), 'Exam submit');
    return {
      learner_choices_uncached: choices.sample,
      library_uncached: library.sample,
      learning_start: learningStart.sample,
      first_question_ready: { ...learningStart.sample, network_ms: learningStart.sample.payload_ready_ms },
      save_draft: draft.sample,
      answer_confirmation: answer.sample,
      finish_quiz: finish.sample,
      profile_refresh: profile.sample,
      exam_start: examStart.sample,
      exam_save_answer: examSave.sample,
      exam_submit: examSubmit.sample,
    };
  });
}

async function repeated(operation, region, count) {
  const samples = [];
  for (let index = 0; index < count; index++) {
    try {
      if (operation === 'learner_choices') {
        samples.push((await invoke('family-api', { action: 'learner_choices' }, { region })).sample);
      } else {
        samples.push(await withQaRun(async prepared => {
          const functionName = operation === 'exam_start' ? 'exam-v2-api' : 'learning-api';
          const action = operation === 'exam_start' ? 'start_exam' : 'start_quiz';
          return (await invoke(functionName, { action, quiz_slug: QA_QUIZ_SLUG }, { session: prepared.session, region })).sample;
        }));
      }
    } catch {
      samples.push({ ok: false, network_ms: null, backend_ms: null });
    }
  }
  return samples;
}

async function regionComparison() {
  const operations = ['learner_choices', 'learning_start', 'exam_start'];
  const result = {};
  for (const operation of operations) {
    result[operation] = {};
    for (const [label, region] of Object.entries(REGIONS)) {
      const samples = await repeated(operation, region, SAMPLE_COUNT);
      result[operation][label] = {
        end_to_end: summarizeSamples(samples, 'network_ms'),
        backend: summarizeSamples(samples, 'backend_ms'),
        observed_regions: [...new Set(samples.map(sample => sample.edge_region).filter(Boolean))],
        samples,
      };
    }
  }
  return result;
}

function requestAction(request) {
  try { return JSON.parse(request.postData() || '{}').action || ''; } catch { return ''; }
}

function requestMatches(request, functionName, action) {
  return request.url().includes(`/functions/v1/${functionName}`) && requestAction(request) === action;
}

function captureRequest(page, functionName, action) {
  const requestPromise = page.waitForRequest(request => requestMatches(request, functionName, action), { timeout: 30000 })
    .then(request => ({ request, started_at: performance.now() }));
  const responsePromise = page.waitForResponse(response => requestMatches(response.request(), functionName, action), { timeout: 30000 })
    .then(async response => {
      const headers = await response.allHeaders();
      return {
        response,
        response_at: performance.now(),
        backend_ms: parseFiniteHeader(headers['x-flh-backend-ms']),
        database_operations: parseFiniteHeader(headers['x-flh-db-operations']),
        correlation_id: headers['x-flh-correlation-id'] || null,
        edge_region: headers['x-flh-edge-region'] || headers['x-sb-edge-region'] || null,
      };
    });
  return observeRejection(Promise.all([requestPromise, responsePromise])
    .then(([started, completed]) => ({ ...started, ...completed })));
}

async function measureNetworkUi(page, functionName, action, trigger, waitForUi) {
  const request = captureRequest(page, functionName, action);
  const actionStarted = performance.now();
  await trigger();
  const uiReadyPromise = waitForUi().then(() => performance.now());
  const [network, uiReady] = await Promise.all([request, uiReadyPromise]);
  return correlateUiTiming(actionStarted, uiReady, network);
}

async function measureFrontendUi(trigger, waitForUi) {
  const actionStarted = performance.now();
  await trigger();
  await waitForUi();
  return correlateUiTiming(actionStarted, performance.now());
}

async function openQaActivity(page) {
  const program = page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE });
  const programOpen = await measureFrontendUi(
    () => program.click(),
    () => page.locator('[data-book]').filter({ hasText: QA_BOOK_TITLE }).waitFor({ state: 'visible', timeout: 10000 }),
  );
  const book = page.locator('[data-book]').filter({ hasText: QA_BOOK_TITLE });
  await book.click();
  const learningButton = page.locator(`[data-learn="${QA_QUIZ_SLUG}"]`);
  await learningButton.waitFor({ state: 'visible', timeout: 10000 });
  return { programOpen, learningButton };
}

async function measureFinish(page) {
  const finishRequest = captureRequest(page, 'learning-api', 'finish_quiz');
  const profileRequest = captureRequest(page, 'family-api', 'student_profile');
  const actionStarted = performance.now();
  await page.locator('#flhLearnNext').click();
  const resultReadyPromise = page.locator('#learnHome').waitFor({ state: 'visible', timeout: 30000 }).then(() => performance.now());
  const [finishNetwork, resultReady] = await Promise.all([finishRequest, resultReadyPromise]);
  const profileNetwork = await profileRequest;
  return {
    result: correlateUiTiming(actionStarted, resultReady, finishNetwork),
    profile_refresh: {
      ...correlateUiTiming(actionStarted, resultReady, profileNetwork),
      completed_before_result: profileNetwork.response_at <= resultReady,
    },
  };
}

async function measureReturnHome(page) {
  const actionStarted = performance.now();
  await page.locator('#learnHome').click();
  await page.locator('.hero h1').filter({ hasText: 'أهلًا' }).waitFor({ state: 'visible', timeout: 10000 });
  const homeReady = performance.now();
  await page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE }).waitFor({ state: 'visible', timeout: 10000 });
  const libraryReady = performance.now();
  return {
    result_to_home: correlateUiTiming(actionStarted, homeReady),
    return_home_to_library: correlateUiTiming(homeReady, libraryReady),
  };
}

async function measureLearningJourney(page) {
  const { programOpen, learningButton } = await openQaActivity(page);
  const learningStart = await measureNetworkUi(
    page,
    'learning-api',
    'start_quiz',
    () => learningButton.click(),
    () => page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 30000 }),
  );

  const draftRequest = captureRequest(page, 'learning-api', 'save_draft');
  const selectionStarted = performance.now();
  await page.locator('.flh-learn-answer').first().click();
  await page.locator('.flh-learn-answer.selected').waitFor({ state: 'visible', timeout: 10000 });
  const selectionReady = performance.now();
  const draftNetwork = await draftRequest;
  const saveDraft = correlateUiTiming(selectionStarted, selectionReady, draftNetwork);

  const hint = await measureNetworkUi(
    page,
    'learning-api',
    'request_hint',
    () => page.locator('#flhHelp').click(),
    () => page.locator('.flh-hint-card').waitFor({ state: 'visible', timeout: 30000 }),
  );

  const answers = [];
  while (answers.length < QA_QUESTION_COUNT * 4) {
    if (answers.length > 0) {
      await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('.flh-learn-answer').first().click();
    }
    answers.push(await measureNetworkUi(
      page,
      'learning-api',
      'answer',
      () => page.locator('#flhConfirmAnswer').click(),
      () => page.locator('#flhLearnNext').waitFor({ state: 'visible', timeout: 30000 }),
    ));
    const next = page.locator('#flhLearnNext');
    if (isLearningFinishAction(await next.innerText())) break;
    await next.click();
    await page.locator('.flh-learn-answer').first().waitFor({ state: 'visible', timeout: 10000 });
  }
  if (!isLearningFinishAction(await page.locator('#flhLearnNext').innerText())) throw new Error('LEARNING_QUEUE_DID_NOT_COMPLETE');

  const finish = await measureFinish(page);
  const home = await measureReturnHome(page);
  return {
    program_open: programOpen,
    learning_start: learningStart,
    save_draft: saveDraft,
    hint,
    answer_confirmations: answers,
    finish_result: finish.result,
    profile_refresh: finish.profile_refresh,
    ...home,
  };
}

function flattenBrowserCheckpoints(runs, path, key) {
  return runs.flatMap(run => {
    const value = run[path]?.[key];
    return Array.isArray(value) ? value : value ? [value] : [];
  });
}

function summarizeBrowserCheckpoints(runs, path) {
  const keys = ['session_restore_home', 'session_restore_library', 'home_to_library', 'program_open', 'learning_start', 'save_draft', 'hint', 'answer_confirmations', 'finish_result', 'profile_refresh', 'result_to_home', 'return_home_to_library'];
  return Object.fromEntries(keys.map(key => {
    const samples = flattenBrowserCheckpoints(runs, path, key);
    const summary = {};
    for (const field of ['ui_wait_ms', 'frontend_only_ms', 'request_network_ms', 'backend_ms', 'network_transport_ms', 'post_response_render_ms']) {
      summary[field] = summarizeSamples(samples.map(sample => ({ ok: Number.isFinite(sample[field]), [field]: sample[field] })), field);
    }
    summary.database_operations = [...new Set(samples.map(sample => sample.database_operations).filter(value => value !== null))];
    summary.observed_regions = [...new Set(samples.map(sample => sample.edge_region).filter(Boolean))];
    return [key, summary];
  }));
}

async function browserCorrelation() {
  if (process.env.PERF_BROWSER !== '1') return { status: 'skipped', reason: 'PERF_BROWSER is not enabled' };
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const runs = [];
  try {
    for (let index = 0; index < BROWSER_RUN_COUNT; index++) {
      runs.push(await withQaRun(async prepared => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        try {
          const page = await context.newPage();
          const browserErrors = [];
          page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
          page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
          await page.addInitScript(session => localStorage.setItem('learner_session', session), prepared.session);

          const profileRequest = captureRequest(page, 'family-api', 'student_profile');
          const libraryRequest = captureRequest(page, 'student-library-api', 'catalog');
          const navigationStarted = performance.now();
          await page.goto(`${APP_URL}?real_backend_performance=${Date.now()}-${index}#student`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.locator('.hero h1').filter({ hasText: 'أهلًا' }).waitFor({ state: 'visible', timeout: 30000 });
          const homeReady = performance.now();
          await page.locator('[data-open-program]').filter({ hasText: QA_PROGRAM_TITLE }).waitFor({ state: 'visible', timeout: 30000 });
          const libraryReady = performance.now();
          const [profileNetwork, libraryNetwork] = await Promise.all([profileRequest, libraryRequest]);

          const cold = {
            session_restore_home: correlateUiTiming(navigationStarted, homeReady, profileNetwork),
            session_restore_library: correlateUiTiming(navigationStarted, libraryReady, libraryNetwork),
            home_to_library: correlateUiTiming(homeReady, libraryReady, libraryNetwork),
            ...(await measureLearningJourney(page)),
          };
          const warm = await measureLearningJourney(page);
          if (browserErrors.length) throw new Error(browserErrors.join('; '));
          return { run: index + 1, cold, warm };
        } finally {
          await context.close();
        }
      }));
    }
    return {
      status: 'measured',
      app_url: APP_URL,
      run_count: runs.length,
      definitions: {
        cold: 'Fresh browser context with empty app memory and persistent performance caches.',
        warm: 'Same active page and Testing session after the cold journey, with normal in-memory profile/catalog caches.',
      },
      summary: {
        cold: summarizeBrowserCheckpoints(runs, 'cold'),
        warm: summarizeBrowserCheckpoints(runs, 'warm'),
      },
      runs,
    };
  } finally {
    await browser.close();
  }
}

function phaseBreakdown(sample) {
  const phases = sample?.phases || [];
  const cumulative = round(phases.reduce((total, phase) => total + phase.duration_ms, 0));
  const slowest = phases.reduce((current, phase) => !current || phase.duration_ms > current.duration_ms ? phase : current, null);
  return {
    database_operations: sample?.database_operations ?? null,
    cumulative_phase_ms: phases.length ? cumulative : null,
    backend_total_ms: sample?.backend_ms ?? null,
    backend_phase_percent: phases.length && sample?.backend_ms ? round(cumulative / sample.backend_ms * 100) : null,
    slowest_phase: slowest,
    sequential_phases: phases.filter(phase => phase.execution === 'sequential').map(phase => phase.name),
    parallel_phases: phases.filter(phase => phase.execution === 'parallel').map(phase => phase.name),
  };
}

function markdown(report) {
  const rows = Object.entries(report.baseline || {}).map(([name, sample]) => `| ${name} | ${sample.network_ms ?? 'N/A'} | ${sample.backend_ms ?? 'N/A'} | ${sample.database_operations ?? 'N/A'} | ${sample.edge_region ?? 'N/A'} |`);
  const abRows = [];
  for (const [operation, variants] of Object.entries(report.region_ab || {})) {
    for (const [region, result] of Object.entries(variants)) {
      const s = result.end_to_end;
      abRows.push(`| ${operation} | ${region} | ${s.p50_ms ?? 'N/A'} | ${s.p75_ms ?? 'N/A'} | ${s.p95_ms ?? 'N/A'} | ${s.min_ms ?? 'N/A'} | ${s.max_ms ?? 'N/A'} | ${s.sample_count} | ${s.failures} |`);
    }
  }
  const phaseRows = Object.entries(report.learning_phase_breakdown || {}).map(([action, item]) => `| ${action} | ${item.database_operations ?? 'N/A'} | ${item.cumulative_phase_ms ?? 'N/A'} | ${item.backend_total_ms ?? 'N/A'} | ${item.backend_phase_percent ?? 'N/A'} | ${item.slowest_phase?.name || 'N/A'} | ${item.slowest_phase?.duration_ms ?? 'N/A'} |`);
  const browserRows = [];
  for (const path of ['cold', 'warm']) {
    for (const [checkpoint, item] of Object.entries(report.browser_correlation?.summary?.[path] || {})) {
      const p50 = field => item[field]?.p50_ms ?? 'N/A';
      browserRows.push(`| ${path} | ${checkpoint} | ${p50('ui_wait_ms')} | ${p50('frontend_only_ms')} | ${p50('request_network_ms')} | ${p50('backend_ms')} | ${p50('network_transport_ms')} | ${p50('post_response_render_ms')} | ${item.database_operations?.join(', ') || 'N/A'} |`);
    }
  }
  return [
    '# Real backend performance report', '',
    `Generated: ${report.generated_at}`, `Report-only: yes`, `Testing learner only: yes`, '',
    '## Action baseline', '',
    '| Action | End-to-end ms | Backend ms | DB operations | Edge region |',
    '|---|---:|---:|---:|---|', ...rows, '',
    '## Region A/B', '',
    '| Operation | Invocation | p50 | p75 | p95 | min | max | samples | failures |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|', ...abRows, '',
    'Learning answer A/B: not repeated because answer finalization can update Testing mastery outside attempt cleanup. The one-pass baseline still measures it.', '',
    '## Learning phase breakdown', '',
    '| Action | DB operations | Cumulative phases ms | Backend total ms | Backend phases % | Slowest phase | Slowest ms |',
    '|---|---:|---:|---:|---:|---|---:|', ...phaseRows, '',
    '## Browser correlation', '',
    `Status: ${report.browser_correlation?.status || 'not_run'}`,
    `App URL: ${report.browser_correlation?.app_url || 'N/A'}`,
    `Representative runs: ${report.browser_correlation?.run_count || 0}`, '',
    '| Path | Checkpoint | UI wait p50 | Frontend-only p50 | Request p50 | Backend p50 | Transport p50 | Post-response render p50 | DB operations |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|', ...browserRows, '',
    'Full per-run correlation IDs, regions, timings, and cold/warm evidence are preserved in real-backend-performance-report.json.', '',
    report.error ? `Harness error: ${report.error}` : 'Harness completed.',
  ].join('\n');
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    report_only: true,
    learner_boundary: 'Testing only',
    sample_count_per_region: SAMPLE_COUNT,
    baseline: {},
    region_ab: {},
    browser_correlation: { status: 'not_run' },
  };
  try {
    report.baseline = await fullBaseline();
    report.learning_phase_breakdown = {
      start_quiz: phaseBreakdown(report.baseline.learning_start),
      save_draft: phaseBreakdown(report.baseline.save_draft),
      answer: phaseBreakdown(report.baseline.answer_confirmation),
      finish_quiz: phaseBreakdown(report.baseline.finish_quiz),
    };
    report.region_ab = await regionComparison();
    report.browser_correlation = await browserCorrelation();
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'UNKNOWN_BENCHMARK_ERROR';
    process.exitCode = 1;
  }
  fs.writeFileSync('real-backend-performance-report.json', JSON.stringify(report, null, 2));
  const summary = markdown(report);
  fs.writeFileSync('real-backend-performance-summary.md', summary);
  console.log(summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

