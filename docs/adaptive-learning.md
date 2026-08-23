# Adaptive Learning Behavior

## Question interaction

Supported question styles include typed answers and choice-based answers. New multiple-choice content defaults to five answer options.

Each question allows up to four attempts by default. An incorrect attempt does not immediately reveal the answer. Instead, the system progressively increases support:

1. **Hint 1 — Nudge:** a light directional cue.
2. **Hint 2 — Guide:** a clearer strategy or reminder of the relevant rule.
3. **Hint 3 — Strong guide:** a more explicit worked direction without giving the final answer.
4. **Hint 4 — Near solution:** the clearest allowed support before final resolution.

Correct-answer feedback explains why the answer is correct. Incorrect-answer feedback explains the mistake and serves the appropriate progressive hint.

## Attempt scoring

Current default scoring weights are configurable and start as:

- attempt 1: 100%
- attempt 2: 75%
- attempt 3: 50%
- attempt 4: 25%
- unresolved after max attempts: 0%

These numbers are product defaults, not permanent rules.

## Remediation behavior

After three unsuccessful attempts by default, the adaptive engine flags the concept for remediation. The next suitable item should normally:

- target the same learning concept,
- remain at the same difficulty level,
- use a different question variant,
- avoid repeating a question already seen in the current attempt when possible.

The goal is to gather fresh evidence that the learner understood the concept before moving to a different concept or difficulty stage.

## Question pools

Question content can be marked as:

- `core`
- `remediation_pool`
- `challenge_pool`

Initially the system should prefer pre-generated variant pools. This avoids latency, cost, inconsistent generation, and reliance on a live AI call during a child's quiz. Live AI generation may be added later behind the same concept/family abstraction.

## Mastery evidence

Concept mastery is not the same as final correctness. Evidence includes:

- first-try correctness,
- total attempts,
- total hints,
- remediation need,
- question difficulty,
- repeated performance on the same concept,
- progress over time.

## Parent dashboard requirements

Reports should show both a simple overview and drill-down detail. Useful metrics include:

- weighted quiz score,
- raw final-correct percentage,
- first-try correct percentage,
- average attempts per question,
- hints used,
- concepts mastered,
- concepts needing practice,
- remediation count,
- performance by difficulty level,
- progress by concept over time.

This prevents a learner who needed four attempts from appearing identical to a learner who answered correctly immediately.
