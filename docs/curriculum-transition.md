# Curriculum & Language Transition

## Goal

Support learners who study the Turkish MEB curriculum now and will later move to the Syrian Arabic curriculum without treating the change as simple translation.

## Core rule

**Concept, curriculum term, question language, and explanation language are separate dimensions.**

The system must never assume that two terms from different curricula are literal equivalents. A mapping can be:

- exact equivalent
- near equivalent
- partial overlap
- related
- no direct equivalent

Preferred terminology should be verified from the actual curriculum books before being marked as authoritative.

## Delivery model

### Current-year bridge mode

Typical delivery may be:

- question/source wording: Turkish when based on the Turkish book
- explanation: Arabic
- terminology: preserve the Turkish source term and introduce the Syrian Arabic term progressively
- optional dual-term display when useful

### Pre-transition mode

Gradually increase exposure to Syrian Arabic terminology while preserving the known Turkish term as a memory bridge.

### Post-transition mode

- Syrian Arabic terminology becomes primary
- Turkish terminology becomes an optional reminder only
- previously learned concepts remain connected through the curriculum crosswalk

## Data model

### `curriculum_concept_terms`
Stores curriculum-specific terminology per concept, language, grade, book, source page, and verification status.

### `concept_crosswalks`
Maps concepts across curricula and records whether the relationship is exact, approximate, partial, related, or non-equivalent. It can also store prerequisite gaps and bridging strategy.

### `learner_transition_plans`
Stores per-learner transition settings between curricula without hard-coding dates or school years into application logic.

### `learner_term_exposures`
Tracks which terminology the learner has seen and in what context, enabling gradual introduction and parent reporting.

## Language separation

Quiz delivery separates:

1. question language
2. explanation language
3. curriculum terminology language
4. hint language

These may differ in the same question.

Example pattern:

- Turkish curriculum question
- Turkish source term retained
- Arabic explanation
- Syrian Arabic term shown as a bridge

## Source-of-truth rule

Terminology mappings must be built from actual curriculum sources. Do not auto-translate specialized school terminology and mark it authoritative. If the Turkish and Syrian books are both available, verify both sides before marking a term pair as `book_verified`.

## Product behavior

The UI should support four terminology modes:

- `source_only`
- `dual_term`
- `target_first_with_source_hint`
- `target_only`

The learner can move through these modes gradually during the transition year.

## Parent reporting

Future reporting may show:

- concepts already mastered independent of curriculum language
- Syrian terms already introduced
- terms that still require Turkish support
- curriculum gaps that need preparation before the move
- concepts that are similar but not equivalent across curricula

## Important limitation

The transition engine can support Turkish-to-Syrian mapping now, but actual terminology and concept crosswalk content should not be populated from guesses. The Turkish source books must be added before authoritative mappings are created.
