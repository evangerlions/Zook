import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProposalActionable, isTerminalTaskStatus, transitionGoal, transitionPlan,
  transitionProposal, transitionReview, transitionTask,
} from "../../src/modules/lighttick/lighttick-state-machines.ts";

test("LightTick state machines allow documented lifecycle transitions", () => {
  assert.equal(transitionGoal("draft", "active"), "active");
  assert.equal(transitionGoal("paused", "active"), "active");
  assert.equal(transitionPlan("generating", "proposed"), "proposed");
  assert.equal(transitionPlan("active", "superseded"), "superseded");
  assert.equal(transitionTask("pending", "completed"), "completed");
  assert.equal(transitionReview("ready", "acknowledged"), "acknowledged");
  assert.equal(transitionProposal("pending", "accepted"), "accepted");
});

test("terminal resources reject duplicates and invalid backwards transitions", () => {
  for (const command of [
    () => transitionGoal("archived", "active"), () => transitionPlan("failed", "generating"),
    () => transitionTask("completed", "completed"), () => transitionTask("skipped", "in_progress"),
    () => transitionReview("acknowledged", "ready"), () => transitionProposal("rejected", "accepted"),
  ]) assert.throws(command, (error: any) => error.code === "LIGHTTICK_STATE_TRANSITION_INVALID");
  assert.equal(isTerminalTaskStatus("completed"), true);
  assert.equal(isTerminalTaskStatus("pending"), false);
});

test("proposal actionability distinguishes expired and already-decided proposals", () => {
  assert.doesNotThrow(() => assertProposalActionable("pending", "2026-08-21T00:00:00Z", new Date("2026-08-20T00:00:00Z")));
  assert.throws(() => assertProposalActionable("pending", "2026-08-19T00:00:00Z", new Date("2026-08-20T00:00:00Z")),
    (error: any) => error.code === "LIGHTTICK_PROPOSAL_STALE");
  assert.throws(() => assertProposalActionable("accepted", "2026-08-21T00:00:00Z"),
    (error: any) => error.code === "LIGHTTICK_PROPOSAL_NOT_PENDING");
});
