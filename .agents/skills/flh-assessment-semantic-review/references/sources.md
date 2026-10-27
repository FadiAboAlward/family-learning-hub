# Origin and adaptation notes (27 October 2026)

## Source works studied

1. Anthropic + Learning Commons: `k12-check-for-understanding/SKILL.md`
   https://github.com/anthropics/k12-teacher-skills/blob/main/plugin/skills/k12-check-for-understanding/SKILL.md
   Useful: 1–3 question checks, misconception-grounded distractors, explain what each response reveals, two final verification gates: >1 defensible answer? Is each distractor reachable by a real student's reasoning? **Math-only** in the published skill: adapt principles, don't imply exact transfer to Turkish Grade 5 English.
2. Anthropic + Learning Commons K12 rubrics:
   https://github.com/anthropics/k12-teacher-skills/blob/main/evals/README.md
   Useful: binary evidence-backed checks, pedagogical appropriateness, level of cognitive challenge, grader calibration. Some rubrics depend on proprietary Learning Commons Knowledge Graph not connected to this project; our source of truth is the assigned book and student outcomes.
3. Microsoft Eval Triage & Improvement `SKILL.md`:
   https://github.com/microsoft/eval-guide/blob/main/skills/eval-triage-and-improvement/SKILL.md
   Useful: first rule out eval-setup problems (rubric, source, grader) before treating item as faulty; hard-block vs soft-score; failures get exact root cause, not vague retrials. Copilot-specific machinery should not be copied.
4. OpenAI Codex skill-creator:
   https://github.com/openai/skills/blob/main/skills/.system/skill-creator/SKILL.md
   Useful: concise SKILL.md, deterministic tests bundled separately, smallest practical workflow; skill is not an installed tool and does not automatically change repo/production.
5. Community generic quiz-generator example:
   https://github.com/SkillMedev/skills/blob/main/skills/quiz-generator/SKILL.md
   Useful: design distractors from misconceptions / vary cognitive demand; lower priority than authority-grade K12 source and not proof of tested reliability.

These are inspiration URLs; this pilot SKILL.md is original adaptation and not a verbatim fork. License attribution should accompany any future direct code reuse. This repository-local helper is optional. Its cited sources are inspiration only; its guidance does not replace the canonical SOP, tests, or independent semantic QA.