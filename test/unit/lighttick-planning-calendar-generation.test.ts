import assert from "node:assert/strict";
import test from "node:test";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

test("conversational planning uses the owner's schedule and never generates for an empty permitted window", async () => {
  const clock = () => new Date("2026-11-23T03:00:00Z");
  const owner = { appId: "lighttick", userId: "weekday-planning-owner" } as const;
  const repository = new InMemoryLightTickRepository();
  const service = new LightTickPlanningService(repository, clock);
  const goal = await new LightTickGoalService(repository, clock).create(owner, {
    title: "练习归纳要点", constraints: { weekly_available_minutes: 30 },
  });
  const created = (await service.command(owner, "create-calendar-session", "create", undefined, { goal_id: goal.id })).session;
  const ready = (await service.command(owner, "set-calendar-period", "context", created.id, { base_version: created.version,
    fields: {
      period_start: { value: "2026-11-23", source: "confirmed" },
      period_end: { value: "2026-11-29", source: "confirmed" },
    } })).session;
  await repository.planningAvailability.save(owner, { version: 1, available_weekdays: [6, 7] });
  await repository.plannedRest.save(owner, { date: "2026-11-29", version: 1, planned_rest: true });

  let requestedDate = "2026-11-28";
  let calls = 0;
  let calendar: unknown;
  const worker = new LightTickAiRunner(repository, { complete: async ({ messages }) => {
    calls += 1;
    calendar = JSON.parse(messages.at(-1)!.content.split("\nINPUT_JSON=")[1]!).planning_calendar;
    return { modelKey: "calendar-fixture", provider: "openai", providerModel: "calendar-fixture",
      text: JSON.stringify({ tasks: [{ title: "练习提炼一句话", estimated_minutes: 10, scheduled_for: requestedDate }] }) };
  } }, clock);
  const queue = async (key: string) => {
    const current = await service.get(owner, ready.id);
    return service.command(owner, key, "drafts", current.id, {
      base_version: current.version, context_revision: current.contextRevision, deep_planning: true,
    });
  };
  const valid = await queue("queue-weekend-draft");
  assert.equal((await worker.execute(owner, valid.run!.id, "week_plan")).status, "succeeded");
  assert.deepEqual(calendar, { allowed_dates: ["2026-11-28"], timezone: "UTC" });

  requestedDate = "2026-11-29";
  const invalid = await queue("reject-draft-on-rest");
  assert.equal((await worker.execute(owner, invalid.run!.id, "week_plan")).status, "failed");
  assert.equal((await repository.listPlans(owner)).length, 1);
  assert.deepEqual(await repository.listTasks(owner), []);

  await repository.planningAvailability.save(owner, { version: 2, available_weekdays: [] });
  await assert.rejects(queue("empty-calendar-draft"), { code: "LIGHTTICK_UNAVAILABLE_PLANNING_DAY" });
  assert.equal(calls, 2);
  assert.equal((await service.get(owner, ready.id)).activeRunId, undefined);
});
