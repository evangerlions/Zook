import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LocalAdoptionService } from "../../src/modules/lighttick/manual/local-adoption.service.ts";
const o = { appId: "lighttick", userId: "adopt-user" } as const,
  clock = () => new Date("2026-10-31T04:00:00Z");
export const adoptionInput = () => ({
  workspace_id: "workspace-123",
  source_secret: "abcde0123456789abcde0123456789abcdef",
  goals: [
    {
      id: "g1",
      title: "Local goal",
      criteria: "Example",
      status: "active" as const,
      archived: false,
    },
  ],
  actions: [
    {
      id: "a1",
      goal_id: "g1",
      title: "Undated local action",
      date: null,
      estimated_minutes: null,
      criteria: "",
      details: "Private details",
      completed_at: "2026-10-30T04:00:00Z",
      archived: false,
      source_reflection_id: null,
    },
  ],
  reflections: [
    {
      id: "r1",
      goal_id: "g1",
      action_id: "a1",
      result: "Partly done",
      obstacles: "Noise",
      next_step: "Try again",
      created_at: "2026-10-30T05:00:00Z",
    },
  ],
  events: [
    {
      id: "e1",
      entity_id: "a1",
      kind: "completed",
      value: "2026-10-30T04:00:00Z",
      created_at: "2026-10-30T04:00:00Z",
    },
  ],
});
test("explicit adoption preserves source history, maps stable IDs once, rejects another owner, and never resurrects deleted data", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new LocalAdoptionService(repo, clock),
    input = adoptionInput();
  const a = await service.adopt(o, "adopt-request-one", input);
  assert.equal(a.mappings.length, 3);
  assert.deepEqual(await service.adopt(o, "adopt-request-one", input), a);
  const reorder = (v: any): any =>
    Array.isArray(v)
      ? v.map(reorder)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, reorder(x)]),
          )
        : v;
  const next = await service.adopt(o, "adopt-request-two", reorder(input));
  assert.deepEqual(next.mappings, a.mappings);
  assert.equal((await repo.listTasks(o)).length, 1);
  const task = (await repo.listTasks(o))[0];
  assert.equal(task.estimatedMinutes, null);
  assert.equal(task.completedAt, input.actions[0].completed_at);
  assert.equal(
    (await repo.listReflections(o))[0].createdAt,
    input.reflections[0].created_at,
  );
  assert.equal(
    JSON.stringify(await repo.getOperation(o, "adopt-request-one")).includes(
      input.source_secret,
    ),
    false,
  );
  await assert.rejects(
    () => service.adopt({ ...o, userId: "other" }, "adopt-other-owner", input),
    { statusCode: 409 },
  );
  await repo.deleteOwnerData(o);
  assert.equal((await repo.listTasks(o)).length, 0);
  await assert.rejects(() => service.adopt(o, "adopt-after-delete", input), {
    statusCode: 410,
  });
});
test("selection is closed, changed sources do not overwrite cloud, and failure rolls back claims as well as entities", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new LocalAdoptionService(repo, clock),
    input = adoptionInput();
  await assert.rejects(() =>
    s.adopt(o, "adopt-incomplete", { ...input, goals: [] }),
  );
  const save = repo.saveReflection.bind(repo);
  repo.saveReflection = async () => {
    throw Error("failure");
  };
  await assert.rejects(() => s.adopt(o, "adopt-request-one", input));
  assert.equal((await repo.listTasks(o)).length, 0);
  assert.equal((await repo.listGoals(o)).length, 0);
  repo.saveReflection = save;
  await s.adopt(o, "adopt-request-one", input);
  await assert.rejects(
    () =>
      s.adopt(o, "adopt-changed-one", {
        ...input,
        actions: [{ ...input.actions[0], title: "Changed after transfer" }],
      }),
    { statusCode: 409 },
  );
  assert.equal((await repo.listTasks(o))[0].title, input.actions[0].title);
});
