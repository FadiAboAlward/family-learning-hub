# Engine / Content Separation

The app is designed as a reusable learning engine. Quiz behavior belongs to the engine; curriculum questions, explanations, hints, assets, and metadata belong to content data.

## Engine responsibilities

- learner authentication and session state
- Learning Mode behavior
- Exam Mode behavior
- adaptive retries, hints, remediation, timers, persistence, scoring, gamification, reports
- navigation and result-review UI

## Content responsibilities

- curriculum / subject / book / unit / lesson references
- source PDF pages and visual assets
- question text and answer choices
- correct answers and explanations
- hint levels and expanded hints
- question concepts, difficulty, and source/adaptation labels

## Scaling rule

New quizzes should be created by inserting/versioning quiz content in Supabase and reusing the same engine. Creating a new unit quiz should not require copying or rebuilding the application shell.

The current fractions sample still contains some hard-coded question content in the frontend and should be migrated into the existing quiz/content tables before broad curriculum scaling.
