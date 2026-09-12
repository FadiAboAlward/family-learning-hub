import assert from 'node:assert/strict';
import { createBackendPerformanceTrace, performanceJsonResponse } from '../supabase/functions/_shared/backend-performance.mjs';

{
  const ticks = [0, 5, 17.34, 18.91];
  const logs = [];
  const trace = createBackendPerformanceTrace({
    action: 'start_quiz',
    region: 'ap-southeast-1',
    correlationId: '123e4567-e89b-42d3-a456-426614174000',
    now: () => ticks.shift(),
    logger: line => logs.push(line),
  });
  await trace.measure('start.quiz_lookup', { dbOperations: 1 }, async () => 'ok');
  const response = performanceJsonResponse(trace, { ok: true }, 200, { 'content-type': 'application/json' });
  const event = JSON.parse(logs[0]);
  assert.equal(event.event, 'backend_performance');
  assert.equal(event.action, 'start_quiz');
  assert.equal(event.total_ms, 18.9);
  assert.equal(event.database_operations, 1);
  assert.equal(event.edge_region, 'ap-southeast-1');
  assert.equal(event.result_status, 'success');
  assert.deepEqual(event.phases, [{ name: 'start.quiz_lookup', duration_ms: 12.3, db_operations: 1, execution: 'sequential' }]);
  assert.equal(response.headers.get('x-flh-correlation-id'), event.correlation_id);
  assert.equal(response.headers.get('x-flh-db-operations'), '1');
  assert.match(response.headers.get('server-timing'), /start\.quiz_lookup;dur=12\.3;desc="sequential:1"/);
}

{
  const learnerName = 'PRIVATE_LEARNER_NAME';
  const learnerToken = 'PRIVATE_LEARNER_TOKEN';
  const authNonce = 'PRIVATE_AUTH_NONCE';
  const answer = 'PRIVATE_ANSWER_CONTENT';
  const logs = [];
  const trace = createBackendPerformanceTrace({
    action: learnerName,
    region: learnerToken,
    correlationId: authNonce,
    now: () => 1,
    logger: line => logs.push(line),
  });
  trace.setAction(answer);
  trace.complete({ learnerName, learnerToken, authNonce, answer }, 500);
  const log = logs[0];
  assert.equal(JSON.parse(log).action, 'unknown');
  assert.equal(JSON.parse(log).edge_region, 'unknown');
  for (const secret of [learnerName, learnerToken, authNonce, answer]) assert.equal(log.includes(secret), false);
  assert.equal(JSON.parse(log).result_status, 'server_error');
}

console.log('Backend performance telemetry unit tests passed.');
