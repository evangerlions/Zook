---
name: dialogue-review
description: Review or rewrite AINovel dialogue for character voice, relationship pressure, information flow, and scene movement. Use when dialogue feels flat, artificial, interchangeable, or unable to change the situation.
---

# Dialogue review

Use this Skill for dialogue-level problems. Fix plot logic or character state
first when those are the actual cause of a weak exchange.

## Required context

1. Call `read_writing_context` before making a character or relationship judgment.
2. Call `read_draft` for the target scene.
3. Preserve the established facts, goals, secrets, and relationship state.

## Review rules

- Every important line must reveal intent, apply pressure, exchange information,
  or change a relationship; remove empty agreement and author exposition.
- Give each speaker distinct vocabulary, rhythm, sentence length, and avoidance
  habits that fit the character state.
- Put conflict, leverage, or an unanswered need under the literal words.
- Prefer action beats and consequence over repeated dialogue tags or emotion labels.
- Do not make every speaker equally articulate or equally polite.

## Output

Identify the speaker, the pressure failure, and the smallest repair. When a
rewrite is requested, return the revised exchange plus a brief reason. Do not
write durable story state or use write tools.
