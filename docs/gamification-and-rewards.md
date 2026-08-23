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
