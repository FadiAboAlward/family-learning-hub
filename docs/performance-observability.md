# Backend performance observability

## Scope

This layer measures existing backend behavior without changing Learning or Exam architecture. It adds no migration, does not change an Exam RPC, and does not pin an Edge region.

The existing `tests/performance.mjs` remains the deterministic, merge-blocking frontend responsiveness test. `tests/real-backend-performance.mjs` is a separate report-only benchmark against the real backend.

## Telemetry contract

The tracked learner-facing functions emit one `backend_performance` JSON event per instrumented action. The event contains only:

- action and result status;
- total and named phase durations in milliseconds;
- phase execution shape (`sequential` or `parallel`);
- database-operation counts;
- `SB_REGION` Edge region;
- a generated request correlation UUID;
- response byte count and HTTP status.

Learner names and identifiers, learner sessions, authorization nonces, answers, question/content values, and credentials are never telemetry fields. Unknown action values are recorded as `unknown`, and response bodies contribute only their encoded byte count.

Responses keep their existing JSON body and add these safe headers:

- `x-flh-correlation-id`
- `x-flh-backend-ms`
- `x-flh-db-operations`
- `x-flh-edge-region`
- `Server-Timing`

The CORS policy exposes those headers and accepts Supabase's documented `x-region` invocation header. The normal application does not set `x-region`; regional routing therefore remains unchanged.

## Instrumented paths

- `learning-api`: `start_quiz`, `save_draft`, `request_hint`, `answer`, and `finish_quiz`, including access, attempt, queue, grading, mastery, award, and review phases.
- `student-library-api`: access, program-content, direct-assignment, catalog, and published-version query groups.
- `family-api`: `learner_choices`, `student_login`, and `student_profile`, including profile/gamification query groups.
- `exam-v2-api`: warmup plus action-level authentication and RPC timing for start/save/submit; flagging retains its three existing PostgREST operations.

The counts describe Supabase/PostgREST/RPC calls made by the Edge Function. A parallel query group counts every database operation while its duration is the wall-clock duration of the group.

## Benchmark safety and lifecycle

The real-backend harness can run only inside the repository's `QA Gate` workflow because it obtains a short-lived learner session through the existing GitHub OIDC-bound `qa-auth` function. `qa-auth` verifies the repository, actor, hosted-runner environment, workflow path, canonical `test` learner metadata, and fixed `qa-automation-core` quiz.

Every stateful sample acquires the single Testing lease. Prepare and cleanup delete only attempts belonging to the Testing learner and the canonical QA quiz version. The harness never accepts a learner slug or learner ID as input.

The full baseline writes only the following Testing data through normal production APIs:

- one Learning attempt, queue, draft, answer attempts, final answers, submitted result, Testing mastery evidence, and the existing idempotent completion award path;
- one Exam attempt, saved answers, and submitted result.

Attempt-scoped rows are removed by the owned cleanup lifecycle. Testing mastery and an initial idempotent Testing completion award can remain because the existing safe cleanup boundary intentionally deletes only canonical QA attempts. The Testing learner is excluded from real learner and parent metrics. The harness therefore runs one complete finish baseline, not repeated finish samples.

Regional A/B repeats only operations that are safely cleanup-repeatable:

- `learner_choices` (one read query);
- Learning start followed by owned attempt cleanup;
- Exam start followed by owned attempt cleanup.

Learning answer is intentionally not repeated for A/B because a correct/final answer can update Testing mastery outside the existing attempt cleanup boundary. Its latency is measured once in the full baseline. No destructive Production cleanup is used.

## Running the report

Dispatch `QA Gate` on the target branch/SHA with `run_real_backend_performance=true`. The manual job uses ten samples per A/B variant, enables the browser correlation, never applies thresholds, and uploads:

- `real-backend-performance-report.json`
- `real-backend-performance-summary.md`

The A/B uses the same request and input for normal/default invocation and explicit `ap-southeast-1` invocation. It records p50, p75, p95, min, max, sample count, failures, and observed Edge regions. The explicit variant uses `x-region: ap-southeast-1`; no source or deployment setting permanently pins the region.

## Browser correlation

The optional Playwright step uses only the Testing session and canonical QA quiz. It correlates:

`action start -> request start -> response received -> Learning question visible`

The response headers add backend duration and correlation ID, allowing the report to separate pre-request frontend work, network plus Edge/backend time, and post-response rendering. If telemetry source has not yet been deployed, backend and correlation fields are reported as `null`; the harness does not invent them.

## Learning operation shape

The telemetry makes the current waterfall explicit. Expected new-attempt counts are data-dependent, but the common paths are:

| Action | Typical DB operations | Parallel work | Sequential shape |
|---|---:|---|---|
| `start_quiz` new attempt | 14, plus optional asset lookup | question, option, and question-asset payload queries | access checks, attempt lookup/create, queue construction/load |
| `save_draft` | 4 | none | attempt lookup, queue lookup, option validation, draft update |
| `answer` finalized core answer | up to 14 without remediation | none | active-state checks, grading inputs, answer writes, mastery, next activation |
| `finish_quiz` already-awarded path | 10 | answer/question/version scoring inputs | completion checks, submit update, quiz/award/review lookups |

Actual events are authoritative because branches such as resumed attempts, missing assets, hints, remediation, first-time awards, badges, and final-question activation change the count.

## Threshold policy

Production p95 is not a CI gate. After at least three representative benchmark runs, propose thresholds from observed distributions with explicit headroom and separate default-region and Singapore baselines. Deterministic `tests/performance.mjs` remains blocking.

## `finish_quiz` profile refresh recheck

On the current `main`, `platform-dynamic-v2.js` awaits `finish_quiz`, then calls `refreshProfileSoon()`, which starts `student_profile` through a promise without awaiting it, and immediately renders the result. The result is therefore **not** blocked on profile refresh. The home button deliberately awaits a fresh profile before rebuilding the student home screen.

No quick-win PR is needed for result rendering. A future change should preserve this current non-blocking result behavior and can use the browser correlation metric as a regression check.
