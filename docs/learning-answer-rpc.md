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

The Learning answer RPC now records a misconception only when the workspace
`pedagogy.misconception_policy.detect_from_multiple_choice_distractors` switch
allows it and an incorrect selected option has exactly one authored
option-to-misconception mapping in the same workspace whose misconception
matches the active concept. Mapping uniqueness is resolved in one database
statement snapshot, so ambiguous concurrent mappings are not guessed. In that
case the answer-attempt row stores `detected_misconception_id` plus a small
allowlisted `error_classification` payload with source `mapped_distractor`,
and the same transaction emits a `misconception_detected` adaptive event.

When an active `incorrect_attempt` explanation set for that misconception is
eligible for the same workspace, question/concept, attempt number, effective
grade, difficulty, and learner language, the RPC records its
`explanation_set_id` and uses its ordered text blocks as the learner feedback.
For non-final attempts that text replaces only the content of the existing hint
payload, preserving its level and progression; for a finalized incorrect answer
it becomes the returned explanation. If no usable modeled text exists, the RPC
keeps the existing generic hint/final-explanation fallback. Effective grade is
resolved first from the attempt's assignment/enrolled program, then from a
matching primary or unambiguous active program, and only then from
`learners.grade_level` as a display/default fallback. Correct answers, unmapped
distractors, disabled detection, and ambiguous mappings are not classified; the
RPC never infers a misconception from wrongness alone. Finalized same-option
retries return the cached result before creating any additional attempt
evidence, so the diagnostic event is not duplicated by HTTP retry.

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

The migration is forward-only. If this behavior must be rolled back after a
future release, create a new corrective migration that restores the previous
`flh_learning_answer` definition; do not rewrite or delete either historical
migration. The Edge contract and RPC signature stay unchanged, so rollback does
not require a UI or client change.

The exact migration identity for release and reconciliation is
`supabase/migrations/20260930185500_learning_misconception_evidence.sql` for the current RPC definition; the original `20260913145055_learning_answer_rpc.sql` remains immutable history. This feature does not
deploy the Edge function, apply or reconcile that migration in Production, or
claim Production verification. After merge, the release record must identify
that migration, record the `learning-api` deployment, reconcile the remote
migration ledger, and attach the required Production verification evidence
before the change is described as complete in Production.
