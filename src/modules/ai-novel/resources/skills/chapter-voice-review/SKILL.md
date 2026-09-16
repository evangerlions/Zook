---
name: chapter-voice-review
description: Review a chapter for consistency with the established narrative voice, focalization, and tone. Use when the author asks whether the prose still sounds like this novel.
---

# Chapter voice review

This Skill checks whether the narration still sounds like this book. It is an
expression and viewpoint review, not a plot, continuity, or generic “make it
prettier” pass.

## Required reading order

1. Call `read_writing_context` before reviewing voice. Use the real result for
   language, tone, focalization, genre, and established character constraints.
2. Call `read_draft` for the complete target chapter or the exact passage.
3. Call `search_story_history` only when a prior prose sample is needed to
   establish the book's baseline. Do not search broadly or imitate an author.
4. Read `references/voice-checklist.md` before finalizing the review.

## Review dimensions

- **Narrator:** person, tense, narrative distance, diction, rhythm, imagery,
  and emotional restraint remain compatible with the established voice.
- **Focalization:** every detail, inference, and metaphor is available to the
  current viewpoint character; do not reveal knowledge they cannot have.
- **Tone:** the emotional temperature and degree of seriousness fit the scene,
  genre, chapter purpose, and the book's declared tone.
- **Language texture:** sentence length, paragraph rhythm, repetition, idiom,
  terminology, and level of abstraction feel intentional rather than generic.
- **Character voice boundary:** dialogue and interior language remain distinct
  from the narrator and from other characters; a state-driven change is valid
  when the story gives it a cause.

## Evidence and repair rules

- Identify the smallest passage or repeated pattern that drifts, then compare it
  with a concrete context constraint or established sample.
- Mark `blocking` only when viewpoint leakage, language mismatch, or tone drift
  materially breaks comprehension or the requested reading experience.
- Mark `warning` for a local drift and `info` for a deliberate variation that
  remains coherent.
- Separate a true voice issue from a plot or character-state issue. Do not use
  style edits to hide a missing motivation or continuity break.
- Preserve facts, event order, character decisions, reveal timing, and the
  author's intentional genre choice.

## Output contract

Return:

1. A short baseline statement describing the voice being checked.
2. Findings in severity order, each with `severity`, `location`, `evidence`,
   `drift`, and the smallest expression-level repair.
3. A concise verdict when no material drift is found.

If rewriting was requested, rewrite only the bounded passage and preserve its
meaning. Do not modify the chapter, Contract, MainLine, or other durable state.
