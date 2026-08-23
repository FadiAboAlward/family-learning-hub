# Pedagogy Engine

The platform does not treat feedback as a fixed message after a right or wrong answer. Feedback, hints, explanations, and remediation are selected according to the learner, grade level, question difficulty, attempt number, detected misconception, and available learning media.

## Core principles

1. **Supportive language by default**
   - Encourage effort and strategy, not only the final score.
   - Never shame, label, or discourage the learner.
   - Feedback must stay age-appropriate and concise enough for the learner's stage.
   - A correct answer should include a short explanation of *why* it is correct.
   - An incorrect answer should provide a clear next step rather than simply saying "wrong".

2. **Progressive support**
   - Attempt 1: light nudge.
   - Attempt 2: clearer guidance.
   - Attempt 3: stronger guidance, worked sub-step, or example.
   - Attempt 4: near-solution explanation and then remediation with a new question from the same concept/difficulty when needed.

3. **Misconception-aware feedback**
   - Multiple-choice distractors can be mapped to known misconceptions.
   - Typed/numeric responses may be classified when possible.
   - Prefer a misconception-specific explanation over generic retry feedback.
   - Fall back to attempt-level explanation when the misconception cannot be classified confidently.

4. **Multimodal explanations**
   Explanations are composed from ordered blocks. Supported block types:
   - text
   - image
   - math
   - steps
   - example
   - diagram
   - audio
   - video
   - interactive

   A single explanation may combine several blocks. Example: a short sentence + a crop from the book + a worked example + a visual diagram.

5. **Source fidelity**
   - When an explanation depends on a book figure, diagram, fraction model, geometry drawing, table, or other visual, use the original source image/crop whenever available.
   - For mathematics, visually authoritative source pages remain the reference for symbols, fractions, angles, layouts, and diagrams.

6. **Do not overwhelm the learner**
   Multimodal does not mean "show everything at once". The engine should choose the smallest useful combination first, then add stronger or more visual support after repeated errors.

## Personalization inputs

The current schema supports learner-specific instructional profiles including:
- primary and secondary language
- explanation depth
- supportive tone
- visual support preference
- optional reading-level override

The quiz runtime should also consider:
- learner grade
- concept mastery
- question difficulty
- attempt number
- response time
- prior hints used
- detected misconception
- previous remediation success

## Data model

Key tables added for the pedagogy layer:
- `learner_instruction_profiles`
- `feedback_templates`
- `explanation_sets`
- `explanation_blocks`
- `misconceptions`
- `question_option_misconceptions`

Attempt telemetry records which feedback/explanation was served and which modalities were used so parent reporting can distinguish:
- first-try mastery
- success after hints
- success after explanation
- success after remediation
- repeated misconception patterns

## Parent reporting

Parent-facing reporting should never reduce learning to a single percentage. Useful indicators include:
- first-try correct rate
- average attempts per concept
- average hints used
- misconceptions seen repeatedly
- which explanation modality helped before success
- concepts requiring remediation
- mastery trend over time

## Configurability

Behavior is stored in Supabase settings rather than hard-coded where practical. Current relevant keys include:
- `pedagogy.feedback_policy`
- `pedagogy.explanation_modalities`
- `pedagogy.misconception_policy`
- `quiz.adaptive_defaults`

This allows future changes to tone, hint depth, explanation strategy, scoring, or remediation without destructive schema rewrites.
