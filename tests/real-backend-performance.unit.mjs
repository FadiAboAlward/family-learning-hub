import assert from 'node:assert/strict';
import { parseServerTiming, summarizeSamples } from './real-backend-performance.mjs';

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
