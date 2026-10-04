# Gamification and Rewards Engine

## Goal

Use gamification to increase engagement and persistence without turning learning into score-chasing. The system should celebrate mastery, improvement, consistency, and effort — not raw marks alone.

## Core mechanics

- XP and learner levels.
- Reward Points as a separate spendable balance.
- Streaks and consistency tracking.
- Badges for meaningful learning behavior.
- Real-world rewards configured by the parent: outings, activities, experiences, privileges, gifts, or custom rewards.
- Parent approval before a real-world reward is considered earned/redeemed.
- Full event ledger for reporting and auditability.

## Default levels

1. 🌱 مستكشف — 0 XP
2. ⭐ متعلّم نشيط — 250 XP
3. 🧩 حلّال تحديات — 600 XP
4. 🚀 متمكن — 1100 XP
5. 🏆 بطل المعرفة — 1800 XP

These thresholds are configuration, not permanent product rules.

## Reward design principles

A real reward should normally depend on one or more of:

- concept mastery,
- improvement over the learner's own previous performance,
- consistent learning activity,
- productive effort and persistence.

Avoid using score alone as the only reward trigger. Repeatedly farming an already-solved question should not produce unlimited XP or Reward Points.

## Real-world reward flow

1. Parent defines a reward, for example a family outing or chosen activity.
2. Parent defines eligibility: required level, Reward Points, and/or structured criteria.
3. Learner sees progress toward the reward.
4. When eligible, learner can request/claim it.
5. Claim enters `pending` state.
6. Parent approves or rejects.
7. After the activity/gift is actually delivered, the parent marks the reward as `redeemed`.

## Data model

- `gamification_levels`
- `learner_gamification_state`
- `gamification_events`
- `gamification_badges`
- `learner_badges`
- `gamification_rewards`
- `reward_claims`

## Default safeguards

- Gamification is enabled.
- Fun Learning Mode is enabled.
- XP, levels, streaks, badges, and reward progress may be shown to the learner.
- Real-world rewards require parent approval by default.
- Score-only reward logic is discouraged.
- Repeated-question XP farming should be capped.
- Celebration intensity defaults to `medium`.

## Reporting

Parent reporting should distinguish:

- earned XP and why it was awarded,
- Reward Points earned/spent,
- level progression,
- streak history,
- badges earned,
- active reward goals,
- pending/approved/redeemed real-world rewards,
- whether progress came from mastery, improvement, consistency, or effort.

## Family behavior and real-world reward management

Current refinement contract: `FEATURE_ID: FLH-FEAT-2026-010`, `SPEC_VERSION: 1.1`, `DRIVE_REVISION_ID: 2`. The [v1.1 Drive Feature Spec](https://docs.google.com/document/d/1OKE1SPoE5DqpaZtx0V2FM6t2CjuXE1BSighc5Phx5-E/edit) is pinned in [Issue #123](https://github.com/FadiAboAlward/family-learning-hub/issues/123). The original v1.0 contract remains the baseline for behavior not changed by v1.1.

### Point domains and history

XP is academic progression. Household habits, responsibilities, initiative and family-defined behaviors award Reward Points only. Both academic and approved behavior points remain spendable in the existing balance. Every new family ledger event records its source, learner, reason, actor/requester, reviewer and timestamps. Approved behavior snapshots include category/rule names, base points, initiative bonus and total. For example, tidying a room can produce one award of 8 points explained as 5 base + 3 initiative. Later rule/category edits do not rewrite that explanation.

`gamification_events` remains the authoritative event ledger. Parent and learner pages can paginate its history and filter by category/source; parent totals aggregate the full history rather than just the displayed recent page. Legacy academic events retain their original data and are presented as academic sources. Manual corrections, reversals and refunds require a reason and append a compensating event with an actor. A reversal refers to the original event and can occur only once. Insufficient balances cannot be driven below zero. New family/spend/adjustment ledger rows cannot be directly updated or deleted, and their XP delta must be zero. Existing authorized learner/workspace deletion still removes dependent events through the existing foreign-key cascade; this exception requires nested trigger execution and actual absence of the deleted parent. It adds no erasure endpoint, grants or ledger-edit bypass.

The academic source filter and breakdown group include legacy null/empty sources and `academic`, `quiz`, `quiz_attempt`, `learning` and `exam`. Family behavior, reward spending and documented adjustments retain their separate filters. A successful command followed by a failed catalog refresh is reported as saved with a refresh-needed message; it must not invite a duplicate financial submission.

### Categories, behavior rules and approval

Parents can create, edit and disable categories and behavior rules. Editable defaults are learning, personal responsibility, initiative/independence, household contribution, habits/values, health/self-care and custom. There are no imposed religious or moral rules.

Rules include title/description, category, base points, optional initiative bonus, active state, all-real or selected learner scope, self-report permission, parent approval policy and cadence (`unlimited`, UTC `day`, UTC `week`) with an award limit. Selected-learner relations enforce workspace integrity. Unlimited cadence has no limit value; limited cadence requires a positive maximum. Approval-time cadence is enforced under the learner transaction lock, so backdating an occurrence or submitting simultaneous reports cannot farm points.

A parent can record an already-approved occurrence directly. An eligible learner can self-report only a rule that explicitly allows it. Every learner report enters `pending`, contributes zero points, and awaits parent approval regardless of the optional policy flag, as required by AC-06. Parent rejection contributes no points. Approval rechecks the current rule, category, learner scope and cadence before awarding the current rule's base points and any initiative bonus. Each approved occurrence updates the balance and creates exactly one event. The same idempotency key returns the existing result only for the same normalized command, verified actor, reason and explicitly supplied occurrence time; conflicting reuse is rejected. Omitting an occurrence time remains a stable retry rather than adopting a new timestamp.

Version 1.1 adds occurrence-level duplicate safety on top of request idempotency. A learner self-report with the same learner, rule and exact `occurred_at` as an existing pending submission reuses that pending row even when a new request key is generated. Approval refuses `DUPLICATE_OCCURRENCE` when another approved submission already represents the same learner/rule/time occurrence, so legacy duplicate pending rows cannot double-award. Parents may then reject the remaining duplicate explicitly.

For `FLH-FEAT-2026-017` ([Feature Spec](https://docs.google.com/document/d/1h1EQCVjyDQG45oxSlfEi22qbd1r5tiOKM4V61BwppdI/edit), [Issue #116](https://github.com/FadiAboAlward/family-learning-hub/issues/116)), a behavior rule can additionally define `adhkar_bonus_points`. When that value is positive, the prayer check-in UI exposes “قرأت أذكار ما بعد الصلاة” beside the existing initiative choice. The submitted boolean `adhkar_completed` is part of the idempotency signature; the RPC derives the point amount from the rule, stores `adhkar_bonus_points` on the submission, and snapshots the base, initiative and adhkar components in the single family-behavior event. A request cannot claim adhkar on a rule with a zero configured bonus.

### Reward configuration and claims

Parents can create, edit and disable activities, outings, experiences, privileges, gifts and custom rewards. Configuration includes description, required points and/or level, learner scope, availability period, redemption limit and optional criteria. Supported criteria are minimum XP (`min_xp`), current/longest streak (`current_streak`, `longest_streak`) and required badge codes (`required_badge_codes`). Unknown or invalid criteria are rejected rather than silently ignored. Malformed historical criteria keep the catalog readable but make the affected reward ineligible with `INVALID_CRITERIA` until a parent corrects it; its stored criteria and history are preserved.

Editing or disabling an existing rule/reward preserves learners already assigned to its selected scope even if they later become inactive. Those assignments are visibly marked inactive in the edit form; newly assigning an inactive or foreign-workspace learner remains forbidden. Both the rewards page and the existing learner profile filter rewards to the verified learner's scope, without exposing another learner's assignments.

Learner cards show personal progress and server-calculated eligibility, with a clear reason when a requirement is unmet. The lifecycle is `request → pending → approved/rejected → redeemed`. Request and approval both revalidate eligibility and the current reward price. Approval atomically deducts that price once and appends a `reward_claim` spend event. Rejection never changes the balance. Redeemed records delivery only. Duplicate requests, retrying approval and simultaneous spending cannot double-spend or overspend. Request notes and adjustment reasons/actors/deltas are part of their idempotency signatures, so altered commands cannot reuse an old key. Refunds use a reasoned compensating adjustment instead of modifying an old spend event.

### API and authorization

All operations are POST actions of `family-api`:

| Caller | Actions |
| --- | --- |
| Parent owner/admin | `parent_rewards_dashboard`, `parent_rewards_ledger`, `parent_behavior_report`, `category_save`, `rule_save`, `reward_save`, `behavior_record`, `behavior_review`, `reward_review`, `reward_redeem`, `points_adjust` |
| Verified learner session | `student_rewards_dashboard`, `student_rewards_ledger`, `student_behavior_report`, `behavior_submit`, `reward_request` |

Save actions accept an optional `id` to edit/disable an existing record. Creation and updates validate fields server-side. Behavior records/requests and adjustments require an `idempotency_key`; review decisions are `approved` or `rejected`. Ledger reads support `before_id`, `page_size` (maximum 100), `source_type` and `category_id`; only a parent may supply a learner filter. Behavior report reads support `period` (`last7` occurrences or `last30` days), `category_id` and `rule_id`; `parent_behavior_report` requires an explicitly selected learner while `student_behavior_report` always derives the learner from the verified learner session. Approved report history uses the snapshotted category when present so later rule edits do not rewrite historical classification. The transport never forwards a learner-supplied learner ID, workspace, actor, reviewer or calculated point delta. Public errors are allowlisted codes, with no raw database details or child free text in telemetry.

The service-role-only RPC uses `SECURITY INVOKER` and a fixed empty search path. It rechecks owner/admin membership for parent actions. New tables have RLS and parent-only reads; writes go through the server command. Authenticated direct writes to rewards, claims, points state and event history are revoked. Existing academic service-role functions retain their permissions and behavior. Every financial operation locks the same learner row as academic completion to avoid lost updates across the two point sources.

### Test isolation and delivery

All-real rules/rewards exclude test learners. A selected scope can include the dedicated `test` learner for an isolated test run. Parent catalogs normally exclude test learners; authenticated `test_only` reads support QA without mixing test summaries into real family reporting. QA uses synthetic fixtures or disposable local/CI databases and must not alter Aya/Mohammad production state.

The forward-only migration is `20261001085355_family_rewards_and_behaviors.sql`. It adds categories/rules/scopes/submissions and idempotency/security boundaries, seeds editable categories, and preserves existing balances and academic history. Historical migrations are unchanged. The linked prayer-adhkar extension is forward-only in `20261002163500_prayer_adhkar_bonus.sql`; it adds optional rule/submission fields and replaces the service RPC without rewriting the historical migration. Production migration and Edge deployment require separate explicit user approval; opening this PR does not authorize them.

The v1.1 refinement is forward-only in `20261004164500_family_rewards_ux_refinements.sql`. It replaces the service RPC with the exact-pending reuse and duplicate-approval guard while leaving the historical migrations untouched. The browser entry flow uses category → behavior progressive disclosure, Today/Yesterday/custom date choices with Now/day-part/custom time, learner-grouped pending approvals with learner-level bulk approval, and a lightweight Last 7 / Last 30 days behavior report. The report is derived from the existing submission history and does not create a second analytics/history model.

Before the separately approved Production migration, recheck both unique-index predicates on the actual target with an aggregate-only read. Each conflict count must be zero:

```sql
select 'family_source' as constraint_name, count(*) as conflicting_groups
from (
  select 1 from public.gamification_events
  where source_type in ('family_behavior','reward_claim','manual_adjustment')
    and source_id is not null
  group by workspace_id, learner_id, source_type, source_id
  having count(*) > 1
) conflicts
union all
select 'reversal_once', count(*)
from (
  select 1 from public.gamification_events
  where source_type = 'manual_adjustment'
    and metadata->>'reversal_event_id' is not null
  group by workspace_id, learner_id, (metadata->>'reversal_event_id')
  having count(*) > 1
) conflicts;
```

If either count is nonzero, stop deployment and prepare a separately reviewed forward reconciliation plan. Do not automatically delete duplicate financial events or change balances. Index creation itself fails closed if conflicting rows appear after preflight. The aggregate-only target snapshot on 2026-10-01 at 23:36 UTC found zero existing events for all three new source types and zero conflicts; that snapshot is evidence for this review, not a substitute for deployment-time verification.

Deterministic coverage includes API identity/owner-admin unit tests, real PostgreSQL schema/RLS/transaction contracts and concurrency tests, and parent/Testing-learner browser flows at desktop and 390×844. Static quality must pass before Browser smoke. Screenshots are temporary CI artifacts with seven-day retention. TestSprite uses this exact revision and its AC-01 through AC-22; reproducible product defects receive deterministic regressions. QA Gate and CodeRabbit, including built-in/custom checks and Change Stack, must cover the exact PR-head SHA.
