# FLH-FEAT-2026-030 — Learning attempt scoring (v1.1)

Canonical product requirement: [Drive Spec](https://docs.google.com/document/d/1XK62CabAaXW7YJP8k_amvQNImUi9Rw4sGVSB2AxU_BY/edit) revision **3**. GitHub tracking: [Issue #159](https://github.com/FadiAboAlward/family-learning-hub/issues/159).

## Points policy

This applies to **Learning Mode** and every grade, subject and supported answer format (single-choice or typed numeric/short-answer), once the new function migration is released.

| Correct on attempt | Credit for this question |
|---|---:|
| First | 100% |
| Second | 50% |
| Third | 0% |
| Fourth or later (where question permits) | 0% |
| Not correct by final attempt | 0% |

A correct third/fourth try still finalizes as **correct** and can show feedback and remediation. Zero credit **must not be silently changed to a wrong answer**, and does not establish mastery. The four progressive hint levels and retries remain instructional, not a reason to remove practice opportunities. Parent-facing first-try and hint indicators are a separate product requirement, not a new parent UI behavior delivered by this scoring-only PR.

## Stable scoring and old attempts

The server-side `flh_learning_start` RPC atomically stores the new score policy on each newly created **core** question queue row in `public.quiz_attempt_question_queue.score_policy_snapshot` (nullable JSONB, server/service-role-only writes):

```json
{"version":"learning-100-50-0-0-v1","attempt_scores":[100,50,0,0]}
```

This is the authoritative source of the score policy. The `quiz_attempts.metadata` table remains editable by some authenticated parents/managers and is **not trusted for scoring**, whether its policy keys are present, missing, forged or overwritten. The queue is tied to the existing owned attempt and its first `source_role='core'` row (ordered by `sequence_no`). It has SELECT-only access for authenticated users and no client INSERT/UPDATE rights.

Both `flh_learning_answer` and `flh_learning_answer_response` select that exact server-owned first core policy and reject a non-null malformed/unrecognized policy before saving any answer or advancing its queue. This includes ungraded typed/reflection questions with an early return. A valid snapshot overrides legacy `quiz_versions.settings.attempt_scores`.

Older already-started attempts have NULL in the dedicated queue snapshot, even if their editable attempt metadata is changed. They continue using the published per-version `attempt_scores`, or the original `[100,75,50,25]` fallback. In particular, a resumption after deployment must **not** convert an existing attempt halfway through a quiz. No historical backfill or regrading occurs. Exam/Paper scoring remains unchanged.

## QA

Run existing isolated contracts, now extended to check 100/50/0/0 and the historical curve:
- `tests/learning-start-rpc.contract.sql` verifies server-issued per-attempt snapshot.
- `tests/learning-answer-rpc.contract.sql` verifies first through fourth correct attempts, hints, finalized correct with zero points, idempotent retry, malformed policy rejection and legacy scoring.
- `tests/support-workbook-typed-learning.contract.sql` verifies second-attempt 50%, third-attempt 0%, and historical typed 75% behavior.
- Existing `learning-answer-rpc.concurrency.mjs` and `learning-start-rpc.concurrency.mjs` safeguard atomic RPC/idempotency; other contracts protect RLS/mastery.

Run the complete isolated fresh-database migration rebuild and GitHub Actions Static quality before Browser smoke; all automated data fixtures are Testing-only. Run authenticated Browser QA only in isolated Testing; never use Mohammad or Aya's actual work as synthetic tests.

## Deployment/rollback boundary

The migration is forward-only, adds a nullable server-owned column on the existing queue and replaces three authorized functions without changing existing RLS or privileges. No Production migration, backend deployment, merge, or changes to any live student's stored attempt have been made by merely creating this branch. If rollback becomes necessary, use a **new** forward-only corrective migration restoring the previous function versions; never edit migration history. After a separately approved Production release, verify actual new/legacy Learning attempts and Exam immutability.
