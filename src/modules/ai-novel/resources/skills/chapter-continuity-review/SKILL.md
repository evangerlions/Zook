---
name: chapter-continuity-review
description: Review the current chapter for conflicts with established facts, character state, timeline, and the active chapter plan. Use when the author asks for a continuity check.
---

# Chapter continuity review

This is an evidence-first consistency check, not a prose polish pass. Use it
when the author asks whether a chapter contradicts what the story has already
established or whether the chapter stays inside its current plan.

## Required reading order

1. Call `read_writing_context` before making any continuity judgment. Treat its
   real tool result as the current Contract, MainLine, character state, and
   chapter context.
2. Call `read_draft` for the complete target chapter or the exact passage under
   review.
3. Call `search_story_history` only when the context and draft do not establish
   the fact needed to decide a finding. Search for evidence, not inspiration.
4. If a chapter-frame or current-brief result is required to resolve the plan
   boundary, read it before deciding whether a beat is out of scope.

Read `references/checklist.md` before finalizing the review.

## Check these dimensions

- **Canonical facts:** names, identities, locations, objects, abilities, rules,
  promises, and constraints must match the established source.
- **Timeline and knowledge:** event order, elapsed time, travel, injuries,
  recoveries, and what each character could know at that moment.
- **Character state:** goals, motives, relationships, emotions, secrets, body
  state, and decisions must have a supported transition.
- **Chapter boundary:** the draft must pursue the active chapter goal and beat;
  later milestones, reveals, locations, or abilities must not be treated as
  already achieved without an explicit cause.
- **Causality and payoff:** important actions need a trigger and consequence;
  a reveal or payoff must have evidence or setup in the available context.

## Evidence and severity

- Quote or identify the smallest relevant draft passage and name the source
  fact, state, or plan that it conflicts with.
- Mark a finding `blocking` only when the contradiction makes the chapter
  impossible to interpret or violates a hard story constraint.
- Mark a finding `warning` for a likely drift that can be repaired locally.
- Mark `info` for a deliberate change that is coherent but worth recording.
- If evidence is missing, say that it is unknown; never invent canon to close a
  gap. Distinguish an intentional reveal or state change from an accidental
  contradiction.

## Output contract

Return:

1. A one-sentence verdict: `no conflict found` or the highest-severity issue.
2. Findings in severity order. Each finding includes `severity`, `location`,
   `evidence`, `conflict`, and the smallest repair direction.
3. Any unresolved evidence gap that prevents a stronger conclusion.

Do not modify Contract, MainLine, Draft, or any other durable story state. Do
not turn this review into a general style critique; route expression problems
to a voice or dialogue Skill.
