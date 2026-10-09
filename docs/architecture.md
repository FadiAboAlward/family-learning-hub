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

The learner library's next action is a read-only summary of the authenticated learner's published versions, eligible version assignments and Learning/Exam attempts. Each mode keeps the start RPC's routing order: original in-progress version, eligible explicit assignment, then latest publication. Incomplete activities precede completed results; completed Learning-only exercises lead to their own result instead of a disabled Exam. A historical result never marks a newer untouched version complete. Program-authorized quizzes and eligible version-bound assignments also appear as dedicated activities when outside the book hierarchy; completed assignments require the learner's own submitted attempt before appearing there as results. Existing submitted history remains the result-review path, and alternate supported modes remain optional. The summary does not grant access, create attempts or expose answers; returning from a mode, refreshing or switching learner sessions reloads it. Catalog cache invalidation is scoped to that session and preserves pending Exam answer saves. Catalog-only book/unit/quiz assignments do not become start permission when the existing RPC requires program access or a version-bound quiz assignment.

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

## Learner library next actions

The FLH-024 v1.1 learner library derives its read-only next action from the verified learner's published versions and compact `flh_learner_journey_progress` evidence. The service-only STABLE invoker RPC returns the newest own attempt per version/mode/status, at most one eligible assignment and one completed assignment backed by an actual own submitted attempt per version, and safe version-level paper evidence. Historical retakes and repeated completed assignments do not consume the transport budget. Existing active immutable versions, assignment availability, paper support exclusion and start-RPC authorization remain authoritative.

`flh_learner_journey_context` discovers legitimate assigned quizzes through ordered UUID pages and reads at most 100 explicit quiz IDs per call. Within the same statement snapshot it selects at most six relevant versions per quiz: latest publication, newest own active Learning and Exam versions, newest eligible assignment, latest own submitted result, and newest completed assignment backed by an own submitted result. It reuses the existing compact progress RPC for those selected versions, including older paper evidence. The library does not fetch every historical publication. Current catalog/access metadata is paged with exact counts and ID queries are chunked; the total legitimate catalog has no fixed 1000-row cap. Missing requested context, inconsistent counts, repeated/nonadvancing cursors and incomplete/error pages fail the whole read rather than returning a truncated catalog or guessing NEW. Both RPCs are service-only STABLE invokers; no public access, answer keys, score, wallet or historical writes are introduced. Forward migrations `20261008210421_learner_journey_compact_progress.sql` and `20261009043102_learner_journey_paged_context.sql` reuse existing scoped indexes and require separate migration authorization.

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

`FLH-FEAT-2026-010` originated in version `1.0`. Family behavior UX/integrity remains version `1.1`, pinned to the [v1.1 Feature Spec](https://docs.google.com/document/d/1OKE1SPoE5DqpaZtx0V2FM6t2CjuXE1BSighc5Phx5-E/edit), Drive revision `2`, in [Issue #123](https://github.com/FadiAboAlward/family-learning-hub/issues/123). Digital Exam mastery rewards are version `1.2`, pinned to the [v1.2 Feature Spec](https://docs.google.com/document/d/1q3a_XYp23Cztoly7IuHfUJCLfcUJ1jfAfCY-7PQGOGo/edit), Drive revision `3`, in [Issue #134](https://github.com/FadiAboAlward/family-learning-hub/issues/134). Unchanged v1.0/v1.1 contracts remain in force. Reward-policy calibration is version `1.3`, pinned to the [v1.3 Feature Spec](https://docs.google.com/document/d/1_xizAeqTaWgNOvrLYS6ZtC5Dq91L-dZ-2pKZNMrKSpk/edit), Drive revision `2`, in [Issue #136](https://github.com/FadiAboAlward/family-learning-hub/issues/136). Unchanged v1.0-v1.2 contracts remain in force.

XP remains academic-only. Academic earnings and parent-approved family behavior feed the existing `learner_gamification_state.reward_points` balance and `gamification_events` ledger. There is no second wallet. New family events always have zero `xp_delta`; Learning and digital Exam Mode are independent academic award sources. Digital Exam rewards are cumulative per learner + quiz, start spendable Reward Points only at 80%, and award only the positive delta on a higher retake. Exam reward ledger rows use `source_type=exam` and the immutable quiz UUID as `source_id`; the digital result refreshes the learner profile after award so Home reflects the new balance immediately. Paper Exam ingestion remains reward-neutral in v1.2.

Parents who are workspace owners/admins manage `behavior_categories`, `behavior_rules`, `behavior_rule_learners`, `behavior_submissions`, existing `gamification_rewards`/`reward_claims`, and `reward_learner_scopes`. Composite foreign keys keep every learner/category/rule/reward relationship within its workspace. Editable default categories do not impose behaviors or values on a family. An all-learner scope includes real active learners; explicit selected scope can include the isolated `test` learner for QA. Normal parent summaries exclude test activity.

The `family-api` verifies the parent JWT or learner session before calling the service-role-only `flh_family_rewards_command` RPC. Reward management requires owner/admin, which is stricter than the teacher-capable learning-management role. Learner identity and workspace come from the verified session; client identities and calculated point totals are discarded. The RPC also verifies parent membership, learner activity, scope and input constraints. Browser code cannot directly modify balances, ledger or claim transitions through authenticated table grants.

Financial commands serialize on the same learner row used by academic completion. Behavior approval rechecks the current active rule/category, learner scope and cadence, then appends one event. New submissions capture their server-calculated component amounts before review; approval honors that valid snapshot across later rule-value changes. Legacy pending rows without this snapshot retain the prior current-rule calculation and are clearly presented as estimates. Other rules keep their UTC approval-day/week award limits. Client occurrence dates cannot bypass cadence. A self-report always remains pending and awards zero points until a parent approves it, including when the rule's stored approval-policy flag is false (AC-06).

Version 1.1 also treats `learner_id + rule_id + occurred_at` as the occurrence identity for duplicate protection. Exact pending learner self-reports reuse the existing pending row; an approval is rejected with a stable duplicate-occurrence conflict if another approved submission already represents that same occurrence. This protection is additive to request-key idempotency and cadence enforcement.

Reward requests and approval check current availability, learner scope, level, supported criteria, redemption limit and balance on the server. Approval spends points once within the transaction; rejection spends nothing, and marking delivery as redeemed never spends again. Idempotency keys, serialized transitions and unique ledger sources protect retries. Reasoned manual adjustments/refunds append compensating events; family ledger rows cannot be directly rewritten or deleted. Existing authorized learner/workspace erasure retains its foreign-key cascade, without granting direct ledger deletion. See `docs/gamification-and-rewards.md` for the fields, endpoints, migration preflight and QA contract.

The parent rewards page presents balances, category/source drill-down, pending reviews grouped by learner, learner-level bulk approval, configuration, reward history and a lightweight recent behavior report. The learner rewards page presents only that learner's balance, goals, point reasons, pending items and the same self-only recent report. Parent direct entry retains category → behavior and quick date/time presets. Learner self-report directly lists eligible behaviors, prioritizes actual recent/frequent use, defaults to Today with Yesterday immediately available, and hides clock time and optional notes from the common path. Its internally generated past-date timestamp is retained across retries. Both pages use the existing Arabic RTL shell and expose loading, empty, permission, validation and server-error states. There is no sibling leaderboard or family-wide approve-all action.

### Consolidated family reward UX and parent-return rule

The FLH-FEAT-2026-025 v1.1 candidate is pinned in Issue #146 to [Drive revision 2](https://docs.google.com/document/d/1C6UMosj1mXPi3lDa0RcVzLqGR5HSvsbMssIVm4QOL1E/edit), with child FLH-010 v1.4/v1.5 revisions 2/5 and [v1.7 revision 3](https://docs.google.com/document/d/1YEGO58PTMIAnZ2BQKPHSwaK8NKbMY59ksZmET1FQ98c/edit). It keeps the approved compact inbox: learner-scoped summaries, desktop/mobile cards, captured components, conditional estimates and confirmed per-learner bulk through existing commands. Actual totals count only fresh successful awards; duplicate/cap/unlinked failures stay pending with item errors.

The canonical new behavior is «تقبيل يد الأب أو الأم عند العودة إلى المنزل» under «الأدب وبرّ الوالدين». It awards exactly 2 Reward Points, with no bonus, at most two occasions/4 points per learner across both parents on the verified occasion's Europe/Istanbul day. Parents select an existing occasion or explicitly register a genuine new return during review/direct entry. The child keeps behavior/day/Done, no clock/occasion selector, pending zero.

The service-written workspace-scoped family_return_events register owns the shared server UUID, verified occurrence time and normalized creation-request provenance. Owner/admin-only return_event_create grants no points; parent catalog retrieves a bounded day/cursor list without private creator metadata. Greeting approval/direct recording requires a valid same-workspace return_event_id. The learner financial lock, composite FK and approved learner/event unique index protect the grant. Original child occurred_at/requested_at remain audit data, while final snapshot and family_behavior ledger carry the verified event reference/time/day. Ledger source_id remains the submission ID; one wallet and academic-only XP remain unchanged.

The register keeps RLS enabled and grants access only to service_role. Authenticated parents use the existing verified family-api command and its safe bounded catalog; direct table reads, including owner/admin reads, are denied and cannot expose created_by, request_payload or idempotency_key. Other family tables retain their existing owner/admin read policies. New occasion entry reuses the existing date/time presets: custom fields appear only for the corresponding custom choice, and past/custom days cannot use Now. A failed creation retry preserves the selected actual instant and request key until the parent changes the inputs.

Parent adjudication maps a physical return to its canonical record. Different clocks, keys, submissions, clients or approving parents cannot award that same selected event twice to one learner; another eligible learner can independently earn it. Software does not detect two mistakenly registered records for the same physical return. Parents must reuse the existing occasion. No timestamp window, sensor or separate father/mother bucket is introduced.

The earlier migration 20261008044606_consolidated_family_rewards_v1_4_v1_6.sql is preserved. New forward migration 20261008152126_parent_return_event_identity_v1_7.sql adds the register/binding and updates the RPC. Existing completed NULL-event greeting rows are not backfilled and still count their original local day; legacy pending greetings need explicit parent verification. Used event identity and finalized binding/provenance are immutable. Authorized learner/workspace erasure retains its existing cascade boundary. Unrelated behavior capture/current-policy fallback and UTC approval cadence remain unchanged.

Parent day changes, refresh and pagination use the owner/admin-only `return_events_list` carrier. It reuses the same service-only bounded day/keyset query and returns safe occasion fields before dashboard/history aggregates; the first page remains in the initial parent catalog. Only day, cursor timestamp, cursor ID and page size cross the client boundary.

Implementation remains a candidate until Runner-local database/concurrency, isolated authenticated QA, exact-head GitHub gates and CodeRabbit/Change Stack evidence pass. FLH-026 v1.1 revision 2 governs isolation. No Production application, deployment or real-family QA write is authorized.

### Linked prayer bonuses

`FLH-FEAT-2026-017`, version `1.0`, extends family behavior records so a rule may define an optional server-authoritative `adhkar_bonus_points`. A prayer check-in remains one behavior submission and one ledger event: base points, initiative points and the linked post-prayer adhkar bonus are snapshotted separately and summed atomically. The browser sends only the boolean completion choice; it never supplies the bonus amount. Rules with no configured adhkar bonus reject an adhkar claim. The request idempotency signature includes the adhkar choice, so retries cannot double-award or silently change that choice. `FLH-FEAT-2026-010` v1.3 uses the same architecture for congregation, mosque and sunnah components. The rule stores each bonus amount; the submission stores each completion boolean and awarded component; the RPC rejects a selected component when its configured value is zero and includes all choices in the idempotency signature. The canonical prayer policy caps Fajr at 15 points and every other obligatory prayer at 10, with Asr sunnah configured to zero.

## Optional pre-Learning videos

`FLH-FEAT-2026-018` version `1.5` is the canonical optional-video architecture. The historical `FLH-FEAT-2026-012` identifier is a legacy alias from the original v1.1 implementation only. One or more vetted videos may be tied to the learner, immutable assessment version and exact serving program/curriculum/grade/subject/skill. Assignments use unique positions from 1 through 20 and render as an ordered sequence. Backward-compatible authoring may omit position only while the learner/version has no higher sequence slot; after a multi-video sequence exists, omission fails closed so slot 1 cannot be replaced accidentally, while an explicit position 1 remains a deliberate replacement. Sequence attachment writers serialize per workspace, learner and immutable version with a transaction-scoped advisory lock so the omission guard is correct under concurrent requests. The Learning start RPC retains its single Edge database operation and includes the verified optional-video sequence after normal access checks. Missing, mismatched, expired or unavailable references never prevent the exercise; Exam remains independent.

Viewing evidence is explicit optional Family Learning Hub self-report only: `not_reported`, `not_watched`, `watched_part` or `watched_full`, isolated per video. No YouTube playback seconds, percentage, seek/state/ended-derived metrics are stored. Reports are separate from grading, mastery and gamification. Official provider status is validated before attachment, and learner identity comes from the verified session. Existing attempts retain their full video sequence snapshot across assignment changes and idempotent retries. A learner-only `videos=1` deep link can read the current verified ordered sequence for a progressed Learning attempt without creating or mutating academic progress; Continue Learning follows the existing version-stable resume path. The renderer generation-guards asynchronous player initialization so callbacks from a previously selected lesson cannot control or hide the active lesson. See [optional-learning-videos.md](optional-learning-videos.md) for authoring, status retention, security and release QA.

FLH-FEAT-2026-022 v1.1 (Drive revision 3), integrated by FLH-FEAT-2026-024 v1.1 (revision 2) in Issue #145, prospectively adds reviewed `learning_outcomes` to the existing video association and attempt snapshot. Each optional list contains 1–3 distinct plain-text actions of at most 160 Unicode characters, validated at authoring/SQL boundaries and shown above the active available video. Title/language/outcome edits rotate the educational video revision for future snapshots while existing attempts retain their original educational content. Provider status maintenance stays independent. Current read-only preview reads current assignment outcomes; normal resume reads its pinned snapshot. Legacy rows are not backfilled, and missing/malformed metadata retains nonblocking Watch/Skip. There is no approved standalone readiness source or no-write grading API in this version, so the quick-check action remains hidden; formal answer keys and academic state/attempt/hint/mastery/cursor/reward writes are not part of this addition. See the exact pins and QA boundary in [optional-learning-videos.md](optional-learning-videos.md).

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
