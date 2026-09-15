import assert from 'node:assert/strict';
import { correlateUiTiming, parseBrowserRunCount, parseFiniteHeader, parseSampleCount, parseServerTiming, summarizeSamples } from './real-backend-performance.mjs';

assert.equal(parseSampleCount(), 10);
assert.equal(parseSampleCount('5'), 5);
assert.equal(parseSampleCount('12'), 12);
for (const value of ['nope', '4', '4.5', 'Infinity', 'NaN']) {
  assert.throws(() => parseSampleCount(value), /integer of at least 5/);
}

assert.equal(parseBrowserRunCount(), 3);
assert.equal(parseBrowserRunCount('3'), 3);
assert.equal(parseBrowserRunCount('5'), 5);
for (const value of ['nope', '2', '2.5', 'Infinity', 'NaN']) {
  assert.throws(() => parseBrowserRunCount(value), /integer of at least 3/);
}

assert.equal(parseFiniteHeader('0'), 0);
assert.equal(parseFiniteHeader('0.0'), 0);
assert.equal(parseFiniteHeader('12.5'), 12.5);
assert.equal(parseFiniteHeader('Infinity'), null);
assert.equal(parseFiniteHeader(''), null);

const samples = [100, 200, 300, 400, 500].map(network_ms => ({ ok: true, network_ms }));
samples.push({ ok: false, network_ms: null });
assert.deepEqual(summarizeSamples(samples), {
  p50_ms: 300,
  p75_ms: 400,
  p95_ms: 480,
  min_ms: 100,
  max_ms: 500,
  sample_count: 5,
  failures: 1,
});

assert.deepEqual(parseServerTiming('start.quiz_lookup;dur=12.3;desc="sequential:1", total;dur=20'), [
  { name: 'start.quiz_lookup', duration_ms: 12.3, execution: 'sequential', db_operations: 1 },
  { name: 'total', duration_ms: 20, execution: null, db_operations: null },
]);
assert.deepEqual(parseServerTiming('private learner;dur=99, malformed'), []);

assert.deepEqual(correlateUiTiming(100, 160), {
  ui_wait_ms: 60,
  frontend_only_ms: 60,
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
});

assert.deepEqual(correlateUiTiming(100, 220, {
  started_at: 120,
  response_at: 200,
  backend_ms: 50,
  database_operations: 1,
  correlation_id: 'test-correlation',
  edge_region: 'test-region',
}), {
  ui_wait_ms: 120,
  frontend_only_ms: 40,
  request_start_offset_ms: 20,
  request_started_before_checkpoint_ms: null,
  request_network_ms: 80,
  backend_ms: 50,
  network_transport_ms: 30,
  post_response_render_ms: 20,
  ui_ready_before_response_ms: null,
  database_operations: 1,
  correlation_id: 'test-correlation',
  edge_region: 'test-region',
});

const overlapped = correlateUiTiming(150, 180, {
  started_at: 100,
  response_at: 210,
  backend_ms: 80,
  database_operations: 5,
});
assert.equal(overlapped.ui_wait_ms, 30);
assert.equal(overlapped.frontend_only_ms, 0);
assert.equal(overlapped.request_started_before_checkpoint_ms, 50);
assert.equal(overlapped.ui_ready_before_response_ms, 30);

console.log('Real backend performance reporting unit tests passed.');

