import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickProposalService } from "../../src/modules/lighttick/lighttick-proposal.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "alice" } as const;
const now = new Date("2026-08-20T08:00:00Z"); const clock = () => now;

async function setup() {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Launch", constraints: {} });
  const plans = new LightTickPlanService(repository, clock);
  const proposed = await plans.createProposed(owner, { goalId: goal.id, granularity: "week",
    periodStart: "2026-08-20", periodEnd: "2026-08-27", source: "template",
    tasks: [{ title: "Keep", estimatedMinutes: 30 }, { title: "Cancel", estimatedMinutes: 60 }] });
  const active = await plans.confirm(owner, proposed.id, 1);
  return { repository, active };
}

test("accepting a current proposal supersedes plan and transactionally applies constrained diff", async () => {
  const { repository, active } = await setup(); const [keep, cancel] = active.tasks;
  const proposal = await repository.saveProposal({ ...owner, id: "proposal_a", planId: active.plan.id,
    basePlanVersion: active.plan.version, status: "pending", reason: "Reduce load",
    diff: [{ action: "update_task", task_id: keep!.id, estimated_minutes: 20 },
      { action: "cancel_task", task_id: cancel!.id }], impact: { minutes_delta: -70 },
    expiresAt: "2026-08-21T00:00:00Z", version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const accepted = await new LightTickProposalService(repository, clock).accept(owner, proposal.id, 1);
  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.plan.status, "active"); assert.notEqual(accepted.plan.id, active.plan.id);
  assert.equal((await repository.getPlan(owner, active.plan.id))?.status, "superseded");
  assert.equal(accepted.tasks.find(task => task.id === keep!.id)?.estimatedMinutes, 20);
  assert.equal(accepted.tasks.find(task => task.id === cancel!.id)?.status, "cancelled");
  assert.ok(accepted.tasks.every(task => task.planId === accepted.plan.id));
});

test("proposal expiration and stale base plan are explicit and cannot mutate current commitments", async () => {
  const { repository, active } = await setup(); const service = new LightTickProposalService(repository, clock);
  const expired = await repository.saveProposal({ ...owner, id: "expired", planId: active.plan.id,
    basePlanVersion: active.plan.version, status: "pending", reason: "old", diff: [], impact: {},
    expiresAt: "2026-08-19T00:00:00Z", version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  assert.equal((await service.expire(owner, expired.id)).status, "expired");

  const stale = await repository.saveProposal({ ...owner, id: "stale", planId: active.plan.id,
    basePlanVersion: active.plan.version, status: "pending", reason: "stale", diff: [], impact: {},
    expiresAt: "2026-08-21T00:00:00Z", version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  await repository.savePlan({ ...active.plan, updatedAt: now.toISOString() }, {
    event: { ...owner, id: "plan_external", aggregateType: "plan", aggregateId: active.plan.id,
      eventType: "external", aggregateVersion: 3, payload: {}, occurredAt: now.toISOString(), createdAt: now.toISOString() },
    change: { ...owner, entityType: "plan", entityId: active.plan.id, entityVersion: 3,
      operation: "upsert", changedAt: now.toISOString() },
  }, 2);
  await assert.rejects(service.accept(owner, stale.id, 1), (error: any) => error.code === "LIGHTTICK_PROPOSAL_STALE");
  assert.equal((await repository.getProposal(owner, stale.id))?.status, "superseded");
});
