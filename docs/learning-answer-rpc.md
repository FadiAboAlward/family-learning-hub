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

The Learning answer RPC now records a misconception only when an incorrect
selected option has exactly one authored option-to-misconception mapping for
the active concept in the same workspace. In that case the answer-attempt row
stores `detected_misconception_id` plus a small allowlisted
`error_classification` payload with source `mapped_distractor`, and the same
transaction emits a `misconception_detected` adaptive event. When an active
`incorrect_attempt` explanation set for that misconception is eligible for the
same workspace, question/concept, attempt number, learner grade, difficulty,
and learner language, the answer-attempt row also records its
`explanation_set_id`; otherwise the existing generic feedback/explanation path
remains unchanged. Correct answers, unmapped distractors, and ambiguous mappings
are not classified; the RPC never infers a misconception from wrongness alone.
Finalized same-option retries
return the cached result before creating any additional attempt evidence, so
the diagnostic event is not duplicated by HTTP retry.

Mastery is updated only when a question is finalized, using the same weighted
evidence calculation and first-try counter as before. Hint counters now reflect
the highest hint level actually delivered, so a sparse or missing hint row is
not reported as a hint shown to the learner.

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

After a question is finalized, the exact response and submitted option are
stored inside the queue row's internal `interaction_metadata`. A same-option
retry while the overall attempt is still active returns that response without
inserting another answer attempt, repeating mastery, adding remediation again,
or activating another question. While the queue row itself is still active,
repeating an answer is graded as the next Learning attempt, matching the prior
path. A different option for an already finalized question, a stale/non-active
queue row without a matching finalized response, a completed attempt, or a
cross-learner/workspace request remains rejected.

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

The exact migration identity for release and reconciliation is
`supabase/migrations/20260930185500_learning_misconception_evidence.sql` for the current RPC definition; the original `20260913145055_learning_answer_rpc.sql` remains immutable history. This feature does not
deploy the Edge function, apply or reconcile that migration in Production, or
claim Production verification. After merge, the release record must identify
that migration, record the `learning-api` deployment, reconcile the remote
migration ledger, and attach the required Production verification evidence
before the change is described as complete in Production.
