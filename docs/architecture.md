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
6. results and review are returned only after submission.

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
