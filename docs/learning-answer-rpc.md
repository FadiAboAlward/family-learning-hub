# Learning answer RPC

## Scope

Step 3B-3A changes only the `answer` action in `learning-api`. `start_quiz`,
`save_draft`, `request_hint`, `finish_quiz`, Library, and Exam retain their
existing implementations. Edge placement is unchanged.

## Preserved answer contract

Before this change, `learning-api` performed the following database operations
sequentially: validate the learner-owned active Learning attempt and active
queue row; load the version-bound single-choice question, answer key, prior
attempt count, and version scoring settings; select progressive hint feedback;
clear draft state; record the answer attempt; optionally select and append one
unused same-concept remediation question; persist a finalized answer; update
concept mastery; complete the queue row; and activate the next pending row.

The RPC preserves those rules and the existing response keys:

- `is_correct`, `attempt_no`, and `finalized`;
- `hint`, `hint_level`, and `hints_used`;
- `remediation_added` with the same queue/question payload shape;
- `explanation` and `correct_option_position`, disclosed only at finalization.

The existing Learning implementation does not currently classify or write a
misconception for a selected distractor. The RPC therefore leaves
`quiz_answer_attempts.detected_misconception_id` and `error_classification` at
their existing defaults instead of inventing new pedagogy in a performance PR.
Mastery is updated only when a question is finalized, using the same weighted
evidence calculation and first-try/hint counters as before.

The explicit validation boundary is workspace, active learner, owned active
Learning attempt, version-bound active queue question, and a real option on that
question. The browser still never receives an answer key before finalization.

## Transaction, concurrency, and retry behavior

`public.flh_learning_answer(uuid,uuid,uuid,uuid,integer)` performs the complete
transition in one PostgreSQL transaction. It locks the owned attempt first and
the selected queue row second, which serializes double submits and next-question
activation in a consistent order. The existing unique answer-attempt key remains
the final duplicate-row guard. Mastery uses one atomic upsert so concurrent
attempts cannot overwrite each other's counters.

After finalization, the exact response and submitted option are stored inside
the queue row's internal `interaction_metadata`. A same-option retry while the
attempt is still active returns that response without inserting another answer
attempt, repeating mastery, adding remediation again, or activating another
question. A different option, a stale/non-active queue row, a completed attempt,
or a cross-learner/workspace request remains rejected.

## Security

The RPC is `SECURITY INVOKER` with an empty `search_path` and fully qualified
relations. `PUBLIC`, `anon`, and `authenticated` have no execute permission;
only `service_role` may call it. `learning-api` continues to verify the custom
learner HMAC session before supplying the validated learner and fixed workspace
to the RPC.

## Architecture and rollback

The old Edge path made roughly 12 sequential PostgREST operations for a common
finalized answer. The new Edge path makes one RPC operation; telemetry records
that actual count as `1`. This is a structural result, not a Production latency
claim.

The migration is additive. If behavior regresses after a later Production
release, redeploy the previous `learning-api` source. Its table-based answer path
remains compatible, while the unused RPC and its internal retry metadata are
harmless. Dropping the RPC is not required for rollback.
