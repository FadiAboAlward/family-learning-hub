# Architecture

## Goal

Family Learning Hub is a multi-learner, multi-program learning platform. Adding a learner, curriculum, course, source package, or quiz must not require hard-coding learner names or learner-specific content in the frontend.

## Canonical model

Workspace
→ Learning Programs
→ Learner Program Enrollments
→ Program Subjects / Source Packages / Quizzes
→ Quiz Versions / Questions
→ Attempts / Answers
→ Concept Mastery / Gamification

Reusable learning catalog data and learner-specific delivery/progress are deliberately separated.

## Catalog layer

Reusable content lives in structures such as:

- curricula,
- subjects,
- books/source packages,
- units,
- lessons,
- learning concepts,
- question families,
- quizzes and quiz versions,
- questions, options, hints, explanations, and answer keys.

A source package may be a textbook, course material, worksheet set, custom source, or media collection.

## Delivery layer

Learner-specific delivery uses:

- `learning_programs`,
- `learner_program_enrollments`,
- `program_subjects`,
- `program_books`,
- `program_quizzes`,
- `quiz_assignments`,
- `quiz_attempts`,
- `quiz_attempt_answers`,
- `learner_concept_mastery`.

A learner only receives content through an active program enrollment or explicit assignment. A frontend fallback must never expose unrelated hard-coded content when catalog loading fails.

## Grade semantics

`learners.grade_level` is an optional display/default hint. When a learner has a primary program, the program/enrollment context is the curriculum and grade source of truth. This allows one learner to take courses outside a single school-grade boundary without corrupting the learner account model.

## Parent management

Authorized parents/admins can manage, from the parent dashboard:

- learner grade hints,
- program enrollment,
- program removal,
- primary program designation.

The UI displays program grade/year metadata so grade mismatches are visible before assignment.

## Learning Mode

Learning Mode is server-authoritative:

1. the server verifies learner access to the quiz,
2. the browser receives question content and options but not answer keys,
3. each submitted answer is graded on the server,
4. progressive hints are returned only after incorrect attempts,
5. remediation questions may be added from prepared pools,
6. final answers, mastery evidence, attempt history, and scores are persisted server-side.

## Exam V2

Exam V2 uses the same program access boundary:

1. the server verifies the learner has access through a program,
2. a server-side exam attempt and question queue are created,
3. answers are saved without correctness feedback,
4. answer keys stay server-side while the exam is in progress,
5. submission is graded on the server,
6. results and review are returned only after submission,
7. each server-evaluated submitted question that has a primary linked learning concept contributes exactly one mastery evidence item to that concept; a question with no primary concept link records no mastery evidence, and secondary concept links do not double-count the question.

Paper exams use the same Exam V2 result and concept-mastery path after their exact approved version, queue, mapping, and provenance have passed the dedicated paper-ingestion gate.

The former hard-coded fractions Exam Mode is retired from the live page.

## Test learner

The `test` learner is a preview account. It may mirror real program/assignment availability for testing but is excluded from curriculum and parent performance reporting. Test activity must remain isolated from real learner progress and rewards.

## Change-safety rules

1. **Migration-first:** every database schema change must be a Supabase migration.
2. **Versioned content:** published quiz content is not destructively rewritten in place.
3. **Config over hard-code:** scoring, attempts, hint levels, remediation thresholds, and delivery settings belong in configuration where practical.
4. **Concept-oriented data model:** adaptive decisions operate on learning concepts, not only total scores.
5. **Event traceability:** meaningful adaptive decisions and outcomes should be reconstructable from stored events/attempt data.
6. **Separated answer keys:** answer keys and grading configuration are not part of normal learner question payloads.
7. **RLS by default:** exposed workspace-scoped tables use Row Level Security.
8. **Server-authoritative results:** XP, scores, mastery, and exam results must not trust browser-calculated correctness.
9. **No learner-specific UI constants:** learner names, programs, and available quizzes come from APIs/data.

## Family rewards and habits

`FLH-FEAT-2026-010`, version `1.0`, implements the [frozen Feature Spec](https://docs.google.com/document/d/1lv1RpixgOiSv2JExkXN5IFyNWTt5adLlwkLYNnEwtfc/edit), Drive revision `3`, handed off in [Issue #99](https://github.com/FadiAboAlward/family-learning-hub/issues/99).

XP remains academic-only. Academic earnings and parent-approved family behavior feed the existing `learner_gamification_state.reward_points` balance and `gamification_events` ledger. There is no second wallet. New family events always have zero `xp_delta`; the academic Learning and Exam award paths remain responsible for academic progression.

Parents who are workspace owners/admins manage `behavior_categories`, `behavior_rules`, `behavior_rule_learners`, `behavior_submissions`, existing `gamification_rewards`/`reward_claims`, and `reward_learner_scopes`. Composite foreign keys keep every learner/category/rule/reward relationship within its workspace. Editable default categories do not impose behaviors or values on a family. An all-learner scope includes real active learners; explicit selected scope can include the isolated `test` learner for QA. Normal parent summaries exclude test activity.

The `family-api` verifies the parent JWT or learner session before calling the service-role-only `flh_family_rewards_command` RPC. Reward management requires owner/admin, which is stricter than the teacher-capable learning-management role. Learner identity and workspace come from the verified session; client identities and calculated point totals are discarded. The RPC also verifies parent membership, learner activity, scope and input constraints. Browser code cannot directly modify balances, ledger or claim transitions through authenticated table grants.

Financial commands serialize on the same learner row used by academic completion. Behavior approval applies the current active rule, enforces its UTC approval-day/week award limit, snapshots base points and initiative bonus separately, and appends one event. Client occurrence dates cannot bypass cadence. A self-report always remains pending and awards zero points until a parent approves it, including when the rule's stored approval-policy flag is false (AC-06).

Reward requests and approval check current availability, learner scope, level, supported criteria, redemption limit and balance on the server. Approval spends points once within the transaction; rejection spends nothing, and marking delivery as redeemed never spends again. Idempotency keys, serialized transitions and unique ledger sources protect retries. Reasoned manual adjustments/refunds append compensating events; family ledger rows cannot be directly rewritten or deleted. Existing authorized learner/workspace erasure retains its foreign-key cascade, without granting direct ledger deletion. See `docs/gamification-and-rewards.md` for the fields, endpoints, migration preflight and QA contract.

The parent rewards page presents balances, category/source drill-down, pending reviews, configuration and reward history. The learner rewards page presents only that learner's balance, goals, point reasons and pending items. Both pages use the existing Arabic RTL shell and expose loading, empty, permission, validation and server-error states. There is no sibling leaderboard.

### Linked prayer adhkar bonus

`FLH-FEAT-2026-017`, version `1.0`, extends family behavior records so a rule may define an optional server-authoritative `adhkar_bonus_points`. A prayer check-in remains one behavior submission and one ledger event: base points, initiative points and the linked post-prayer adhkar bonus are snapshotted separately and summed atomically. The browser sends only the boolean completion choice; it never supplies the bonus amount. Rules with no configured adhkar bonus reject an adhkar claim. The request idempotency signature includes the adhkar choice, so retries cannot double-award or silently change that choice.

## Parent reporting

Parent reporting should distinguish:

- first-try correctness,
- correctness after hints,
- attempts used,
- hints used,
- remediation triggered,
- learning vs exam mode,
- concept mastery,
- latest assessed difficulty,
- progress over time.

A final correct answer is not equivalent to first-try mastery.
