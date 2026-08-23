# Family Learning Hub

A shared learning platform for multiple learners, curricula, independent courses, adaptive practice, gamification, real-world rewards, and parent reporting.

**Family Learning Hub is the platform.** ChatGPT projects such as **AI School** are teaching/operator workspaces that can be separated per learner while using the same backend and learner history.

## Live site

- GitHub Pages: `https://fadiaboalward.github.io/family-learning-hub/`

## Core model

The system separates reusable learning content from learner-specific delivery:

- **People:** Workspace → Learners
- **Catalog:** Curricula + Subjects + Source Packages → Units → Lessons → Concepts → Quizzes/Versions/Questions
- **Programs:** Learning Programs → Program Subjects → Program Sources → Program Quizzes
- **Delivery:** Learner Program Enrollments → Assignments → Attempts → Answer Attempts → Mastery / Adaptive Events

A learning program can represent an official curriculum, an independent course, a track, or a custom family program. Learners can participate in one or more programs without hard-coding curriculum/course data into the learner profile.

## Architecture principles

- Multi-learner and multi-program by design; adding a learner must not require frontend code changes.
- Official curricula and independent courses use the same delivery engine through the program layer.
- Program/enrollment context is the source of truth for grade/year/curriculum placement; `learners.grade_level` is only an optional display/default hint.
- Migration-first database changes, committed with their Supabase migration identity.
- Versioned quiz content so historical attempts remain reproducible.
- Configuration over hard-coded behavior.
- Concept-based adaptive learning rather than score-only quizzes.
- Progressive hints and attempt-level telemetry.
- Server-authoritative grading: browser-calculated correctness, mastery, XP, or rewards are not trusted by the canonical learning engine.
- Answer keys are separated from normal question payloads.
- Supportive, age-appropriate, misconception-aware feedback.
- Multimodal explanations using text, images, math, steps, examples, diagrams, audio, video, or interactive blocks as appropriate.
- Curriculum-aware terminology: concept, source term, target term, question language, and explanation language are separate.
- Gamification rewards mastery, improvement, consistency, and effort rather than marks alone.
- Parent-defined real-world rewards require parent approval before redemption by default.
- Parent reporting distinguishes first-try mastery from assisted success.
- Security by default with Supabase Row Level Security (RLS), backend test-account filtering, login throttling, and bcrypt learner PIN hashes after transparent legacy upgrade.

## Test / preview learner

The `test` learner is a sandbox for parent preview. Program enrollments and open assignments for real learners mirror to it by default unless explicitly excluded. Test activity is filtered from real family metrics at the backend boundary.

## Current infrastructure

- **Database / Auth / APIs:** Supabase
- **Source control:** GitHub
- **Frontend / hosting:** Static web application on GitHub Pages
- **Repository visibility:** Public
- **Learning runtime:** database-driven learner choices and program catalog; `learning-api` owns server-side learning attempts, grading, hints, remediation, mastery, and completion awards

## Adaptive quiz defaults

New quiz behavior is configurable in Supabase (`workspace_settings`, key `quiz.adaptive_defaults`). Current defaults include:

- 5 options for new multiple-choice questions.
- 4 attempts per question.
- Up to 4 progressive hint levels.
- Attempt score weights: 100%, 75%, 50%, 25%.
- Remediation trigger after 3 unsuccessful attempts.
- Remediation stays on the same concept and difficulty by default.
- Prefer pre-generated question variants; live generation is disabled initially.

## Curriculum transition

The platform supports learners moving between curricula and languages without treating the change as literal translation. Turkish MEB terminology can remain visible while Syrian Arabic terminology is introduced progressively, then become secondary after the transition.

## Main documentation

- `docs/architecture.md`
- `docs/adaptive-learning.md`
- `docs/pedagogy-engine.md`
- `docs/curriculum-transition.md`
- `docs/gamification-and-rewards.md`
- `supabase/README.md`
- `supabase/migrations/`
- `supabase/functions/`

## Change policy

Every schema change must be a Supabase migration and committed to this repository. Every meaningful behavior change should be configurable or documented so the platform can evolve without destructive rewrites.

The historical hosted-only migration gap is documented in `supabase/README.md`; new migrations are source-controlled from the Family Learning Hub architecture migration onward.
