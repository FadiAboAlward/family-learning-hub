# Architecture

## Goal

Family Learning Hub is designed as a change-friendly, multi-learner, multi-curriculum learning platform. It should tolerate frequent product changes without destructive rewrites.

## Core hierarchy

Workspace → Learners → Curricula → Subjects → Books → Units → Lessons → Quizzes → Quiz Versions → Questions → Attempts → Answers → Mastery.

## Change-safety rules

1. **Migration-first**: every database schema change must be a Supabase migration.
2. **Versioned content**: published quiz content is immutable in-place. New behavior or content becomes a new quiz version.
3. **Config over hard-code**: scoring, attempts, hint levels, remediation triggers, and similar product rules live in settings wherever practical.
4. **Concept-oriented data model**: adaptive decisions operate on learning concepts, not only total quiz scores.
5. **Event traceability**: adaptive choices are logged as events so parent reports and debugging can explain why the system selected a question.
6. **Separation of answer keys**: correct answers and grading configuration are stored separately from normal question content.
7. **RLS by default**: exposed tables use Supabase Row Level Security.

## Adaptive model

A question may belong to a question family and one or more learning concepts. Each question has a difficulty level and may be classified as core, remediation-pool, or challenge-pool content.

Each submitted answer is stored as an individual answer attempt. This preserves the full path through the question instead of only the final result.

A remediation question is selected from the same concept and normally the same difficulty after repeated unsuccessful attempts. This is intentionally implemented as selection from a prepared variant pool initially; live generation can be introduced later behind the same interface.

## Parent reporting model

Parent reporting must distinguish:

- first-try correctness,
- correctness after one or more hints,
- attempts used,
- hints used and highest hint level,
- remediation triggered,
- concept mastery score,
- latest assessed difficulty,
- progress over time.

A final correct answer must never be presented as equivalent to first-try mastery.
