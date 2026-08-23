# Supabase Edge Functions

Tracked production functions:

- `family-api`: learner login/profile and parent account/dashboard compatibility API.
- `learning-api`: program-scoped Learning Mode with server-authoritative grading, hints, remediation, mastery, and completion rewards.
- `parent-program-api`: parent/admin management of learner grade hints and program enrollments.
- `exam-v2-api`: program-scoped Exam V2 with server-side answer persistence and grading; no correctness feedback before submission.

The live frontend must use program/enrollment access checks for learner content. Legacy hard-coded learner-specific exam delivery is retired from `index.html`.
