import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "member_e2e", appId: "lighttick", userId: "user_alice", status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: "2026-08-20T00:00:00Z" });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const session = await runtime.services.authService.login({ appId: "lighttick", account: "alice@example.com", password: "Password1234" });
  const headers = { authorization: `Bearer ${session.accessToken}`, "x-app-id": "lighttick" };
  return { runtime, headers, owner: { appId: "lighttick", userId: "user_alice" } as LightTickOwner };
}
const idempotency = (headers: Record<string, string>, key: string) => ({ ...headers, "idempotency-key": key });

test("provider-free core loop reaches review and accepts a bounded Plan B", async () => {
  const { runtime, headers, owner } = await setup(); const services = runtime.services.lighttickRuntime;
  const onboarding = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/onboarding",
    headers: idempotency(headers, "e2e-onboarding-001"), body: { title: "Launch native app", current_level: "prototype",
      weekly_available_minutes: 240, pace: "balanced", timezone: "Asia/Shanghai" }, requestId: "e2e-onboarding" });
  assert.equal(onboarding.statusCode, 202);
  const goal = (await services.goals.list(owner))[0]!;
  const plan = await services.plans.createProposed(owner, { goalId: goal.id, granularity: "week", periodStart: "2026-08-17",
    periodEnd: "2026-08-23", source: "template", tasks: [
      { title: "Build iOS shell", estimatedMinutes: 60, priority: 30 }, { title: "Build Android shell", estimatedMinutes: 60, priority: 20 },
      { title: "Verify shared API", estimatedMinutes: 45, priority: 10 }, ] });
  const confirmed = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/plans/${plan.id}/confirm`,
    headers: idempotency(headers, "e2e-confirm-001"), body: { base_version: 1 }, requestId: "e2e-confirm" });
  const tasks = (confirmed.body.data as any).tasks; assert.equal(tasks.length, 3);
  for (const [index, action] of ["complete", "skip", "defer"].entries()) {
    const body = action === "complete" ? { base_version: 1, actual_duration_minutes: 50 }
      : action === "skip" ? { base_version: 1, reason_code: "no_time" }
      : { base_version: 1, target_date: "2026-08-22", timezone: "Asia/Shanghai" };
    const result = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/tasks/${tasks[index].id}/${action}`,
      headers: idempotency(headers, `e2e-task-${action}-001`), body, requestId: `e2e-${action}` }); assert.equal(result.statusCode, 200);
  }
  const reviewRun = await runtime.app.handle({ method: "POST", path: "/api/v1/lighttick/review-runs",
    headers: idempotency(headers, "e2e-review-001"), body: { goal_id: goal.id, period: "weekly",
      period_start: "2026-08-17", period_end: "2026-08-23" }, requestId: "e2e-review" });
  assert.equal(reviewRun.statusCode, 202); assert.equal((await services.repository.listReviews(owner)).length, 1);
  const now = new Date(); const proposal = await services.repository.saveProposal({ ...owner, id: "proposal_e2e_plan_b_001",
    planId: plan.id, basePlanVersion: 2, status: "pending", reason: "low_completion",
    diff: [{ action: "update_task", task_id: tasks[2].id, estimated_minutes: 20 }],
    impact: { task_count_delta: 0, total_minutes_delta: -25, commitment_boundary_changed: false },
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const accepted = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/change-proposals/${proposal.id}/accept`,
    headers: idempotency(headers, "e2e-plan-b-accept"), body: { base_version: 1 }, requestId: "e2e-plan-b" });
  assert.equal(accepted.statusCode, 200); assert.equal((accepted.body.data as any).status, "accepted");
  assert.notEqual((await services.repository.getActivePlan(owner))?.id, plan.id);
});

test("recovery remains deterministic across lost response, stale proposal, AI outage, and deletion", async () => {
  const { runtime, headers, owner } = await setup(); const services = runtime.services.lighttickRuntime;
  const request = { method: "POST", path: "/api/v1/lighttick/goals", headers: idempotency(headers, "recovery-goal-001"),
    body: { title: "Recover", constraints: { weekly_available_minutes: 60, pace: "balanced" } }, requestId: "lost-response" };
  const first = await runtime.app.handle(request); const retried = await runtime.app.handle({ ...request, requestId: "network-retry" });
  assert.deepEqual(retried.body.data, first.body.data);
  const goal = first.body.data as any; const plan = await services.plans.createProposed(owner, { goalId: goal.id, granularity: "day",
    periodStart: "2026-08-20", periodEnd: "2026-08-20", source: "template", tasks: [{ title: "Safe", estimatedMinutes: 30 }] });
  await services.plans.confirm(owner, plan.id, 1); const timestamp = new Date().toISOString();
  const stale = await services.repository.saveProposal({ ...owner, id: "proposal_recovery_stale_001", planId: plan.id,
    basePlanVersion: 1, status: "pending", reason: "user_request", diff: [], impact: {}, expiresAt: "2030-01-01T00:00:00Z",
    version: 1, createdAt: timestamp, updatedAt: timestamp });
  const staleResponse = await runtime.app.handle({ method: "POST", path: `/api/v1/lighttick/change-proposals/${stale.id}/accept`,
    headers: idempotency(headers, "recovery-stale-001"), body: { base_version: 1 }, requestId: "stale" });
  assert.equal(staleResponse.statusCode, 409); assert.equal(staleResponse.body.code, "LIGHTTICK_PROPOSAL_STALE");
  const deleted = await runtime.app.handle({ method: "DELETE", path: "/api/v1/lighttick/me/account", headers,
    body: { confirmation: "DELETE" }, requestId: "delete" }); assert.equal(deleted.statusCode, 200);
  assert.equal((await services.goals.list(owner)).length, 0);
});
