import assert from 'node:assert/strict';
import { parseFiniteHeader, parseSampleCount, parseServerTiming, summarizeSamples } from './real-backend-performance.mjs';

assert.equal(parseSampleCount(), 10);
assert.equal(parseSampleCount('5'), 5);
assert.equal(parseSampleCount('12'), 12);
for (const value of ['nope', '4', '4.5', 'Infinity', 'NaN']) {
  assert.throws(() => parseSampleCount(value), /integer of at least 5/);
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

console.log('Real backend performance reporting unit tests passed.');

