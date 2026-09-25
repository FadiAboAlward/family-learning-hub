---
name: Feature Spec implementation
about: Pin a versioned Drive Feature Spec before implementation and QA
title: "[FEATURE] "
labels: []
assignees: []
---

## Feature Spec pin

- FEATURE_ID: `FLH-FEAT-YYYY-NNN`
- SPEC_VERSION: `vX.Y`
- SPEC_URL / Canonical Drive URL:
- DRIVE_REVISION_ID:
- Spec status: `READY_FOR_IMPLEMENTATION`
- Supersedes: N/A / prior spec version

## User request / outcome

Summarize the requested outcome in plain language without changing the canonical Drive spec.

## Frozen acceptance criteria

Copy the numbered acceptance criteria from the pinned spec version.

- AC-01:
- AC-02:
- AC-03:

## Scope / non-goals

In scope:
- [Describe in-scope work]

Out of scope:
- [Describe out-of-scope work]

## Risk / boundaries

- Student flow affected: yes / no
- Parent flow affected: yes / no
- Learning / Exam behavior affected: yes / no
- Data / RLS / authorization affected: yes / no
- Production deployment required: yes / no
- Database migration required: yes / no

## Implementation handoff

- Branch:
- Implementation must use the FEATURE_ID + SPEC_VERSION + DRIVE_REVISION_ID above.
- If observable requirements materially change, stop and pin a new spec version before continuing.
- Preserve minimal diff and the current architecture unless the spec explicitly requires otherwise.

## TestSprite handoff / evidence

- Requirement source used: pinned Feature Spec / N/A — reason:
- Run requirement: required / completed / optional / N/A — reason:
- Run ID or link:
- Outcome: PASS / FINDINGS / BLOCKED_EXTERNAL / N/A — reason/evidence:
- Reproducible product defects converted to deterministic regression coverage where practical: yes / no / N/A — reason:

## Exact-head QA evidence

- PR:
- PR head SHA:
- Static quality result:
- Browser smoke result:
- CodeRabbit exact-head result:
- TestSprite outcome/evidence, or N/A reason:

## Final verification

- Status: pending / completed / N/A
- Result:
- Timestamp (UTC):
- Verifier:
- Deployment / migration identifier:
- Evidence link or exact evidence reference:
- Screenshot artifact / evidence link, or N/A reason:
