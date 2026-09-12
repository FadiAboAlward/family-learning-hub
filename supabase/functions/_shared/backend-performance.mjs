const LABEL_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const REGION_RE = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ACTIONS = new Set([
  "answer", "catalog", "finish_quiz", "learner_choices", "request_hint",
  "save_answer", "save_draft", "set_flag", "start_exam", "start_quiz",
  "student_login", "student_profile", "submit_exam", "warmup",
]);

function safeLabel(value, fallback = "unknown") {
  const label = typeof value === "string" ? value : "";
  return LABEL_RE.test(label) ? label : fallback;
}

function safeAction(value) {
  return SAFE_ACTIONS.has(value) ? value : "unknown";
}

function roundedMilliseconds(value) {
  return Math.max(0, Math.round(Number(value) * 10) / 10);
}

function responseSize(payload) {
  return new TextEncoder().encode(payload).byteLength;
}

function resultStatus(status) {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "success";
}

/**
 * Create one request-local performance trace. Only allowlisted labels and numeric
 * timing metadata can enter the event, so learner/auth/content values never do.
 */
export function createBackendPerformanceTrace({
  action = "unknown",
  region = "unknown",
  correlationId = crypto.randomUUID(),
  now = () => performance.now(),
  logger = (line) => console.log(line),
} = {}) {
  const startedAt = now();
  const phases = [];
  let databaseOperations = 0;
  let recordedAction = safeAction(action);
  const recordedCorrelationId = UUID_RE.test(correlationId) ? correlationId : crypto.randomUUID();
  let completed = false;

  return {
    correlationId: recordedCorrelationId,
    setAction(value) {
      recordedAction = safeAction(value);
    },
    async measure(name, { dbOperations = 0, execution = "sequential" } = {}, task) {
      const safeName = safeLabel(name, "phase");
      const safeExecution = execution === "parallel" ? "parallel" : "sequential";
      const operations = Math.max(0, Math.trunc(Number(dbOperations) || 0));
      const phaseStartedAt = now();
      try {
        return await task();
      } finally {
        const durationMs = roundedMilliseconds(now() - phaseStartedAt);
        phases.push({ name: safeName, duration_ms: durationMs, db_operations: operations, execution: safeExecution });
        databaseOperations += operations;
      }
    },
    complete(payload, status = 200) {
      if (completed) throw new Error("PERFORMANCE_TRACE_ALREADY_COMPLETED");
      completed = true;
      const body = JSON.stringify(payload);
      const totalMs = roundedMilliseconds(now() - startedAt);
      const record = {
        event: "backend_performance",
        version: 1,
        action: recordedAction,
        total_ms: totalMs,
        phases,
        database_operations: databaseOperations,
        edge_region: REGION_RE.test(region) ? region : "unknown",
        correlation_id: recordedCorrelationId,
        response_bytes: responseSize(body),
        http_status: status,
        result_status: resultStatus(status),
      };
      logger(JSON.stringify(record));
      const serverTiming = [
        ...phases.map((phase) => `${phase.name};dur=${phase.duration_ms};desc="${phase.execution}:${phase.db_operations}"`),
        `total;dur=${totalMs}`,
      ].join(", ");
      return {
        body,
        record,
        headers: {
          "server-timing": serverTiming,
          "x-flh-backend-ms": String(totalMs),
          "x-flh-correlation-id": recordedCorrelationId,
          "x-flh-db-operations": String(databaseOperations),
          "x-flh-edge-region": record.edge_region,
        },
      };
    },
  };
}

/** Merge trace headers into a JSON response without changing its response body. */
export function performanceJsonResponse(trace, data, status, headers) {
  const completed = trace.complete(data, status);
  return new Response(completed.body, { status, headers: { ...headers, ...completed.headers } });
}
