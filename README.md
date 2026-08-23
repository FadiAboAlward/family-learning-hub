# Family Learning Hub

A scalable learning platform for multiple learners, curricula, subjects, source packages, programs, quizzes, adaptive practice, exams, gamification, real-world rewards, and parent reporting.

## Live site

- GitHub Pages: `https://fadiaboalward.github.io/family-learning-hub/`

## Architecture principles

- **One shared platform, many learners.** Learner names are data, not frontend configuration.
- **Programs and enrollments are the delivery boundary.** A learner only sees content available through an active program enrollment or explicit assignment.
- **Parent-managed enrollment.** Parents can manage learner grade hints and attach/remove available programs from the parent dashboard.
- **Catalog and progress are separate.** Curricula, subjects, source packages, units, lessons, concepts, and quizzes are reusable catalog data; learner enrollments, attempts, mastery, and rewards are learner-specific.
- **Server-authoritative grading.** Learning Mode and Exam V2 do not send answer keys to the browser before grading. Results are calculated on the server.
- **No unsafe legacy fallback.** If the program catalog fails, the UI must not expose a hard-coded quiz as a fallback because it could belong to another learner.
- **Migration-first database changes.** Schema changes are applied as Supabase migrations and tracked in this repository.
- **Versioned quiz content.** Published quiz versions preserve historical attempt reproducibility.
- **Concept-based adaptive learning.** Progressive hints, remediation, attempt telemetry, and mastery operate at concept level rather than total-score only.
- **Security by default.** Supabase RLS protects exposed tables; learner login is rate-limited and legacy PIN hashes upgrade to bcrypt after successful login.

## Current infrastructure

- **Database / Auth / APIs:** Supabase
- **Source control:** GitHub
- **Frontend / hosting:** Static web app on GitHub Pages
- **Repository visibility:** Public

## Current delivery model

`Workspace → Learning Programs → Learner Program Enrollments → Program Subjects / Source Packages / Quizzes → Attempts → Answers → Mastery`

A learner may have more than one program. `learners.grade_level` is only a display/default hint; the primary program/enrollment is the source of truth for curriculum/grade context when one exists.

The `test` learner is a preview account. It can mirror program availability for testing while remaining excluded from real curriculum and parent performance reporting.

## Learning and exam modes

- **Learning Mode:** server grading, progressive hints, retries, remediation, concept mastery, and post-answer explanations.
- **Exam V2:** program-scoped access, no hints or instant correctness while solving, server-side answer persistence and grading, result/review after submission.
- The former hard-coded fractions exam scripts are retired from the live page.

## Parent controls

The parent dashboard includes a program manager that can:

- set or correct a learner grade hint,
- enroll a learner in an available program,
- remove a program,
- designate the primary program.

Program metadata such as grade and school year is shown before enrollment so mismatches can be noticed before assignment.

## Adaptive quiz defaults

Current configurable defaults include:

- 5 options for new multiple-choice questions,
- 4 attempts per question,
- up to 4 progressive hint levels,
- attempt score weights 100%, 75%, 50%, 25%,
- remediation after repeated unsuccessful attempts,
- prepared remediation/challenge pools instead of live generation by default.

## Main documentation

- `docs/architecture.md`
- `docs/adaptive-learning.md`
- `docs/pedagogy-engine.md`
- `docs/curriculum-transition.md`
- `docs/gamification-and-rewards.md`
- `supabase/migrations/`
- `supabase/functions/`

## Change policy

Every schema change must be a Supabase migration and committed to this repository. New delivery behavior should use Programs/Enrollments and server-authoritative APIs rather than learner-specific frontend code.
