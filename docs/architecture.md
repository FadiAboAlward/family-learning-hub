# Family Learning Hub Architecture

## Goal

Family Learning Hub is one shared learning platform/backend for multiple learners. ChatGPT projects such as **AI School** are operator/teaching workspaces that may be separated per learner, but they do not define platform tenancy or own learner data.

The platform must support learners such as Aya, Mohammad, Abdul Qader, and future learners without code changes for each person. A learner may study one or more official curricula, independent courses, custom tracks, or combinations of them.

## Architectural planes

### 1. Workspace and people

`Workspace → Learners`

- The current canonical workspace is `Family Learning Hub` (`family-learning-hub`).
- `learners` contains identity/profile-level information only.
- `learners.grade_level` is an optional display/default hint, **not** the source of truth for academic placement.
- Pedagogical preferences live in `learner_instruction_profiles`.
- Test/sandbox learners are marked in learner metadata and excluded from real family metrics by backend APIs.

### 2. Reusable content catalog

`Curricula + Subjects + Source Packages → Units → Lessons → Learning Concepts → Question Families → Quizzes → Quiz Versions → Questions`

- `curricula` represents official curricula such as Syrian National or Türkiye MEB.
- `subjects` is reusable across curricula/programs.
- `books` is the legacy table name for a **learning source package**. `source_kind` distinguishes textbooks, course material, worksheets, custom sources, and media collections.
- Units and lessons remain source-aware so PDF/page fidelity can be preserved for textbook-driven content.
- Concepts are the stable pedagogical layer used for mastery and adaptation.
- A quiz is reusable content. Published versions preserve historical reproducibility.
- Correct answers remain separated from normal question payloads.

### 3. Learning programs

`Learning Program → Program Subjects → Program Sources/Books → Program Quizzes`

`learning_programs` is the canonical packaging layer. A program can be:

- `curriculum`: an official curriculum/grade/year offering,
- `course`: an independent course,
- `track`: a structured learning track,
- `custom`: a family-created program.

A program may reference a curriculum, but it does not have to. This lets the same engine support school curricula, Quran courses, English courses, coding courses, targeted mathematics practice, or future course types without changing the learner schema.

Content can be reused in more than one program through `program_subjects`, `program_books`, and `program_quizzes` rather than copied per learner.

### 4. Enrollment and delivery

`Learner → Learner Program Enrollment → Assignment / Available Program Content → Attempt → Answer Attempts → Final Answers → Mastery / Adaptive Events`

- `learner_program_enrollments` is the canonical generic learner-to-program relationship.
- `learner_enrollments` remains a curriculum-specific compatibility/history layer for official curriculum + school year + grade.
- Program/enrollment context is the source of truth for grade, school year, and curriculum placement.
- `quiz_assignments` can optionally point to the learner's program enrollment.
- Program availability and direct assignments are both valid ways to expose content to a learner.
- Attempts and mastery belong to the learner, not to a ChatGPT project.

## Test account policy

The `test` learner is a preview/sandbox account.

- Real learner program enrollments are mirrored to `test` by default.
- Open quiz assignments are mirrored to `test` by default.
- Both behaviors support explicit opt-out metadata for exceptional cases.
- Test activity is excluded by backend parent-reporting and session-reporting logic; UI hiding is not treated as a security/reporting boundary.

## Runtime/API boundaries

### Family API

Owns learner/parent identity-oriented operations such as learner choices, learner PIN login, learner profile, parent registration, and parent dashboard.

Learner PIN login is rate-limited using hashed client identifiers. Raw IP addresses are not stored by the rate-limit table.

### Learning API

Owns the learning-session lifecycle for database-backed quizzes:

1. Resolve learner access from program enrollment or assignment.
2. Create/resume a real quiz attempt.
3. Build a question queue from published content.
4. Return prompts/options **without answer keys**.
5. Grade answers server-side.
6. Reveal only the allowed progressive hint after an unsuccessful attempt.
7. Add remediation questions from the prepared pool when rules trigger.
8. Persist attempt-level telemetry and concept mastery.
9. Calculate final score and gamification awards from server-persisted evidence.
10. Reveal answer/review information only at the configured feedback stage.

The browser must never be the authority for scores, answer correctness, mastery, XP, or rewards.

## Content-context integrity

Database triggers enforce consistency between quiz links:

- quiz subject must match its linked source/book,
- quiz curriculum is derived from its linked source when omitted,
- quiz unit and lesson must belong to the same source/book,
- lesson/unit/book combinations cannot cross source boundaries.

These guards prevent silently attaching a quiz to the wrong curriculum or source.

## Adaptive model

A question may belong to a question family and one or more learning concepts. Each question has a difficulty level and may be classified as `core`, `remediation_pool`, or `challenge_pool` content.

Each submitted answer is stored as an individual answer attempt. This preserves the full path through the question instead of only the final result.

Remediation is selected from prepared variants for the same concept first. Live generation may later be introduced behind the same engine contract without changing learner history.

## Parent reporting model

Parent reporting must distinguish first-try correctness, assisted correctness, attempts, hints, remediation, concept mastery, latest assessed difficulty, and progress over time. A final correct answer is never treated as equivalent to first-try mastery.

Test/sandbox activity must be filtered at the backend before metrics are returned.

## Change-safety rules

1. **Migration-first** — every schema change is a Supabase migration and is committed to this repository.
2. **Versioned content** — published quiz history remains reproducible; meaningful published-content changes use a new version.
3. **Config over hard-code** — product rules live in settings/configuration where practical.
4. **No learner-specific UI constants** — learner choices and learning catalog come from the backend.
5. **Concept-oriented adaptation** — adaptive decisions use concepts/evidence, not only overall scores.
6. **Event traceability** — adaptive choices and meaningful gamification changes remain explainable.
7. **Answer-key separation** — answer keys are never included in normal question payloads.
8. **Server-authoritative grading** — client-calculated correctness/score is not trusted for the canonical learning engine.
9. **RLS by default** — exposed workspace tables use Row Level Security; service-only tables expose no client policies.
10. **Backward-compatible evolution first** — introduce new layers beside legacy paths, migrate safely, then remove compatibility code only after tests prove the new path.

## Current compatibility boundary

The historical fractions exam UI still uses the legacy exam compatibility path. It is hidden from the new program catalog and does not define the new architecture. The target is to migrate exam delivery to the same server-authoritative question/answer lifecycle before retiring the legacy exam code.
