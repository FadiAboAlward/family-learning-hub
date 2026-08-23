# Family Learning Hub

A scalable learning platform for multiple learners, curricula, subjects, books, units, lessons, quizzes, adaptive practice, curriculum transition, gamification, real-world rewards, and parent reporting.

## Live site

- GitHub Pages: `https://fadiaboalward.github.io/family-learning-hub/`

## Architecture principles

- Multi-learner and multi-curriculum from day one.
- Migration-first database changes.
- Versioned quiz content so historical attempts remain reproducible.
- Configuration over hard-coded behavior.
- Concept-based adaptive learning rather than score-only quizzes.
- Progressive hints and attempt-level telemetry.
- Supportive, age-appropriate, misconception-aware feedback.
- Multimodal explanations using text, images, math, steps, examples, diagrams, audio, video, or interactive blocks as appropriate.
- Curriculum-aware terminology: concept, source term, target term, question language, and explanation language are separate.
- Gamification that rewards mastery, improvement, consistency, and effort rather than marks alone.
- Parent-defined real-world rewards with parent approval before redemption.
- Parent reporting that distinguishes first-try mastery from assisted success.
- Security by default with Supabase Row Level Security (RLS).

## Current infrastructure

- **Database / Auth / API:** Supabase
- **Source control:** GitHub
- **Frontend / hosting:** Static web application on GitHub Pages.
- **Repository visibility:** Public

## Adaptive quiz defaults

New quiz behavior is configurable in Supabase (`workspace_settings`, key `quiz.adaptive_defaults`). Current defaults:

- 5 options for new multiple-choice questions.
- 4 attempts per question.
- Up to 4 progressive hint levels.
- Attempt score weights: 100%, 75%, 50%, 25%.
- Remediation trigger after 3 unsuccessful attempts.
- Remediation stays on the same concept and difficulty by default.
- Prefer pre-generated question variants; live generation is disabled initially.

## Curriculum transition

The platform supports learners moving between curricula and languages without treating the change as literal translation. Turkish MEB terminology can remain visible while Syrian Arabic terminology is introduced progressively, then become secondary after the transition.

## Gamification and rewards

The platform supports XP, levels, streaks, badges, Reward Points, parent-defined real-world rewards, claim/approval/redemption status, and detailed event history. Real-world rewards require parent approval by default.

## Main documentation

- `docs/architecture.md`
- `docs/adaptive-learning.md`
- `docs/pedagogy-engine.md`
- `docs/curriculum-transition.md`
- `docs/gamification-and-rewards.md`
- `supabase/migrations/`

## Change policy

Every schema change must be a Supabase migration and committed to this repository. Every meaningful behavior change should be configurable or documented so the platform can evolve without destructive rewrites.
