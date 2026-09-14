---
name: character-voice-review
description: Review whether each AINovel character sounds and behaves like the established person, including vocabulary, rhythm, motives, emotional reactions, and social position. Use for OOC, flat characterization, or indistinguishable voices.
---

# Character voice review

Review character expression together with the character's current state. A
voice change is valid when the story supplies a cause; do not enforce a frozen
voice when grief, fear, disguise, growth, or power changes it.

## Required context

1. Call `read_writing_context` to load character, relationship, and story facts.
2. Call `read_draft` for the relevant chapter or scene.
3. Compare the passage with the active character state, not with stereotypes.

## Review rules

- Check goal, emotion, relationship, body state, knowledge, and social position.
- Check each character's sentence length, word choice, directness, metaphors,
  and habitual evasions.
- Flag sudden obedience, confidence, intimacy, knowledge, or emotional recovery
  without a scene-level cause.
- Avoid making all characters share the narrator's polished explanatory voice.

## Output

Return concrete OOC or voice-drift findings and the smallest local correction.
If no drift is found, say so. Do not alter Contract, MainLine, or Draft through
tools.
