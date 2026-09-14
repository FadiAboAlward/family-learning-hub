# Learning finish RPC

## Scope

Step 3B-5A changes only the `finish_quiz` action in `learning-api`.
`start_quiz`, `save_draft`, `request_hint`, `answer`, Library, Profile, and Exam
retain their existing implementations. Edge placement is unchanged and no
region is pinned.

## Preserved finish contract

Before this change, `learning-api` validated the learner-owned attempt, checked
that no queue row remained pending or active, loaded the core question set and
saved answers, calculated the score, submitted the attempt, loaded quiz
metadata, awarded gamification, looked up and saved eligible badges, and built
the completed-question review through separate Data API calls.

The finish transition continues to:

- accept only an active learner-owned Learning attempt in the same workspace;
- reject an incomplete queue with `QUIZ_NOT_COMPLETE`;
- score only core questions from server-persisted `points_awarded`,
  `first_try_correct`, and `hints_used` values;
- set `status = submitted`, `submitted_at`, score, percentage, duration, and the
  existing `learning-api-v2` server-graded metadata;
- award 25 base XP and 5 reward points, add 20 XP and 5 points at 70 percent,
  add 10 XP for at least two first-try answers, and add 10 XP for sustained
  hint use at a score of at least 40 percent;
- preserve daily streak, longest streak, level progression, the once-per-quiz
  Production award rule, and repeatable Testing-learner award behavior;
- preserve `first-try`, `keep-going`, and `concept-master` badge eligibility and
  avoid inserting an already-owned badge again;
- create one `quiz_completed` gamification event for a newly awarded finish;
- return the existing `ok`, attempt, quiz, scoring, award, and review payload.

The database schema calls the completion timestamp `submitted_at`; there is no
Learning-attempt `completed_at` column to update. Review rows include only the
current completed core answers and their current post-completion answer-key
fields. Grading configuration, internal learner identifiers, unrelated learner
data, and answer keys before completion are not exposed.

## Transaction, concurrency, and retry behavior

`public.flh_learning_finish(uuid,uuid,uuid,integer)` owns the full transition in
one PostgreSQL transaction. It locks the attempt first, matching the Learning
answer lock order, then locks the learner before gamification. Concurrent calls
for the same attempt therefore serialize. The winner stores the complete result
in attempt metadata; a retry after response loss returns that exact result and
does not repeat XP, reward points, events, badges, or finalization.

The learner lock also serializes different finishes for one learner, preserving
the existing once-per-quiz award check without a select-then-insert race. Badge
inserts additionally use the existing unique ownership key with
`ON CONFLICT DO NOTHING`. Any database error rolls back attempt submission and
all side effects together.

## Security

The function is `SECURITY INVOKER`, uses an empty fixed `search_path`, and
schema-qualifies every relation. `PUBLIC`, `anon`, and `authenticated` have no
execute permission; only `service_role` can call it. The Edge Function remains
responsible for authenticating the custom learner HMAC session and passes only
the authenticated workspace, learner, attempt, and bounded duration.

## Architecture and acceptance boundary

The measured Production baseline remains 18 Edge-to-DB operations for the
first-award path:

`browser -> learning-api -> attempt/completion/scoring/finalization/award/badge/review waterfall`

The reviewed source changes that path to one `flh_learning_finish` RPC and one
reported Edge database operation:

`browser -> learning-api -> authenticated flh_learning_finish transaction -> response`

This is structural evidence only. Production latency must not be claimed until
the migration and Edge source are separately authorized, rolled out, and
measured with the Testing learner.

## Rollback

The exact pre-change source SHA is
`219e13bbd2cc7a04e3f844492f16d839f9a1d6b7`. If a later authorized rollout
regresses, redeploy the previous `learning-api` source from that SHA. The
migration is additive, so the unused RPC may remain harmlessly present and no
destructive database rollback is required.
