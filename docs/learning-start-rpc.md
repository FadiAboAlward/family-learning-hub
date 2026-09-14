# Learning start RPC

## Scope

Step 3B-4A changes only the `start_quiz` action in `learning-api`.
`save_draft`, `request_hint`, `answer`, `finish_quiz`, Library, and Exam retain
their existing implementations. `public.flh_learning_answer` and its one Edge
database operation remain unchanged. Edge placement is unchanged.

## Preserved start and resume behavior

Before this change, `learning-api` performed the complete start flow through
separate Data API requests. It selected the active workspace quiz by slug and
the highest numbered published version. Access required either an active
learner-program enrollment whose program exposed the quiz as `available`, or
the newest open assignment for that exact version whose availability window
included the current time.

The old path then resumed the newest in-progress Learning attempt for that
learner and version. Otherwise it created an attempt with
`delivery_mode = learning`, linked the valid direct assignment when present,
and recorded the existing `learning-api-v2` metadata. Every published core
question was queued in version position order. The first row was active, later
rows were pending, `source_role` was `core`, the primary concept was copied when
present, and `selection_reason` was `published_core_question`. A version with
no core questions returned a new attempt with an empty queue; this task does
not invent a different product rule.

On resume, the queue is restored rather than rebuilt. This preserves core and
remediation rows, their sequence and `source_role`, the current active row,
completed/pending state, saved draft option, requested hint level, flag state,
concept, and difficulty. The response retains the effective frontend contract:

- `attempt_id`, `started_at`, `resumed`, and quiz slug/title/description;
- every queue field consumed by Learning, in sequence order;
- question identity, code, position, type, prompt, provenance, source metadata,
  points, adaptive settings, difficulty, and delivery role;
- options in option-position order;
- linked asset purpose, alt text, kind, MIME type, public URL, storage location,
  and asset-position order.

Answer keys, grading configuration, and correctness are not returned.
Unavailable, missing-version, and missing-quiz results keep the existing Edge
error names. An inactive, missing, or cross-workspace learner is treated as
unavailable so the database does not disclose another learner or workspace.

## Transaction, concurrency, and retry behavior

`public.flh_learning_start(uuid,uuid,text)` runs the start/resume transition in
one PostgreSQL transaction. A transaction-scoped advisory lock serializes calls
for the same workspace, learner, published version, and Learning mode. After
the lock, the function rechecks for an existing attempt. Two simultaneous
starts therefore return the same attempt: one creates it and its queue, and the
other resumes it. Attempt and queue inserts share one exception block, so a
queue failure rolls back the newly inserted attempt.

A retry after an interrupted HTTP response resumes the committed attempt and
returns the persisted queue, without creating another active attempt or any
duplicate queue rows. Existing historical attempts are not rewritten or
deduplicated by this additive performance migration.

## Security

The RPC is `SECURITY INVOKER` with an empty `search_path` and fully qualified
relations. `PUBLIC`, `anon`, and `authenticated` have no execute permission;
only `service_role` may call it. `learning-api` continues to verify the custom
learner HMAC session and fixed workspace before calling the RPC. RLS is not
bypassed with elevated function ownership, and the browser still receives no
answer key.

## Architecture, measurement, and rollback

The Production baseline remains recorded as roughly 14 Edge-to-DB operations,
plus the optional asset lookup, before the first Learning question appeared.
The reviewed source changes that structural path to one `flh_learning_start`
RPC and telemetry records the real Edge database-operation count as `1`. This
implementation PR makes no Production latency or regional-routing claim.

The migration is additive. If a later Production rollout regresses, redeploy
the previous `learning-api` version. Its table-based start path remains
compatible with the schema, while the unused `flh_learning_start` function may
remain safely in place. Dropping the RPC or running a destructive emergency
rollback is not required.

The exact migration identity is
`supabase/migrations/20260914111651_learning_start_rpc.sql`. This PR does not
apply or reconcile it in Production, run `db push`, deploy an Edge Function, or
change Production data/schema. Those operations require a separate post-merge
release and verification step.
