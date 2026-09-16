---
name: anti-ai-voice-review
description: Review or revise AINovel prose that feels formulaic, generic, explanatory, or AI-generated. Use after story structure is stable and the author asks to reduce AI flavor or improve concrete web-novel texture.
---

# Anti-AI voice review

Use this Skill for expression-level problems. Do not use it to repair missing
motivation, broken continuity, or an invalid chapter plan.

## Required context

1. Call `read_writing_context` before judging the chapter.
2. Call `read_draft` for the target chapter or passage.
3. Preserve facts, event order, character choices, and the user's requested tone.

## Review rules

- Replace abstract emotion labels with visible action, sensation, choice, or cost.
- Remove summary narration, generic atmosphere, repeated filler adverbs, and
  explanatory conclusions when the scene can show the change directly.
- Vary sentence length and paragraph rhythm; split long sentences that bury a
  beat or a reaction.
- Keep each character's speech and reactions distinguishable.
- Keep at least one concrete change in every reviewed scene: information,
  action, relationship, resource, or risk.

## Output

Report concrete examples with a short replacement direction. If rewriting was
requested, change expression only; never invent facts or silently alter plot.
Do not write Contract, MainLine, or Draft through tools.
