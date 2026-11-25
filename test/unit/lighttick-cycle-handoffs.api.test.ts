import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTodayDataSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

test("GET Today exposes the optional same-account handoff without a reflection or task writes", async () => {
  const owner = { appId: "lighttick", userId: "user_alice" } as const;
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) {
    seed.appUsers.push({
      id: "cycle-" + userId, ...owner, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: "2026-03-01T00:00:00Z",
    });
  }
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const repository = lighttickRuntime.repository;
  let now = new Date("2026-03-06T00:00:00Z");
  lighttickRuntime.today = new LightTickTodayService(repository, () => now);
  await repository.saveProfile({
    ...owner, timezone: "America/Los_Angeles", locale: "en", pace: "balanced", onboardingState: "completed",
    notificationPreferences: {}, onboardingDraft: {}, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validateToday = ajv.compile(LightTickTodayDataSchema);
  let operation = 0;
  const call = async (path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"], userId = owner.userId as string) => {
    const response = await application.app.handle({
      path: "/api/v1/lighttick/" + path, method, query: {}, body, headers: {
        authorization: "Bearer " + tokenService.issueAccessToken(userId, owner.appId),
        "x-app-id": owner.appId, "x-lighttick-task-schema": "2", "idempotency-key": "cycle-operation-" + (++operation),
      },
    });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    return (response.body as { data: Record<string, any> }).data;
  };
  const readToday = async (userId?: string) => {
    const data = await call("today", "GET", undefined, userId);
    assert.equal(validateToday(JSON.parse(JSON.stringify(data))), true, JSON.stringify(validateToday.errors));
    return data;
  };
  const currentDraft = {
    title: "Practice reporting", completion_criteria: "A clear example",
    period_start: "2026-03-02", period_end: "2026-03-08",
    tasks: [{
      id: "practice-1", title: "Summarize what changed", scheduled_for: "2026-03-08", estimated_minutes: 10,
      completion_criteria: "One minute example", guidance: "",
    }],
  };
  const initial = await call("manual-plans", "POST", currentDraft);
  const confirmed = await call("manual-plans/" + initial.id + "/confirm", "POST", {
    base_version: initial.version, goal_base_version: initial.goal_version,
  });
  const before = await readToday();
  assert.equal(before.business_date, "2026-03-05");
  assert.equal(before.cycle_handoffs, undefined);
  now = new Date("2026-03-06T09:00:00Z");
  const handoff = {
    goal_id: initial.goal_id, goal_title: currentDraft.title, plan_id: initial.id,
    period_start: currentDraft.period_start, period_end: currentDraft.period_end,
  };
  assert.deepEqual((await readToday()).cycle_handoffs, [{ ...handoff, state: "ending_soon" }]);
  const nextDraft = {
    ...currentDraft, goal_id: initial.goal_id, period_start: "2026-03-09", period_end: "2026-03-15",
    tasks: [{ ...currentDraft.tasks[0], id: "practice-2", scheduled_for: "2026-03-09" }],
  };
  const next = await call("manual-plans", "POST", nextDraft);
  now = new Date("2026-03-09T09:00:00Z");
  assert.deepEqual((await readToday()).cycle_handoffs, [{ ...handoff, state: "next_draft_pending", next_draft_id: next.id }]);
  assert.equal((await readToday("user_bob")).cycle_handoffs, undefined);
  assert.equal((await repository.listReflections(owner)).length, 0);
  assert.deepEqual((await repository.listTasks(owner)).map(task => task.id), [confirmed.tasks[0].id]);
  const editable = await call("manual-plans/" + next.id);
  assert.equal(editable.status, "proposed");
  const edited = await call("manual-plans/" + next.id, "PATCH", {
    ...nextDraft, base_version: editable.version, tasks: [{ ...nextDraft.tasks[0], title: "Practice the takeaway first" }],
  });
  assert.equal(edited.version, editable.version + 1);
  assert.equal((await repository.listTasks(owner)).length, 1);
  await call("manual-plans/" + next.id + "/confirm", "POST", {
    base_version: edited.version, goal_base_version: edited.goal_version,
  });
  const after = await readToday();
  assert.equal(after.cycle_handoffs, undefined);
  assert.equal(after.tasks[0].title, "Practice the takeaway first");
});
