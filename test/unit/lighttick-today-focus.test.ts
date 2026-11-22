import { test } from "node:test";
import assert from "node:assert/strict";
import { TodayFocusService } from "../../src/modules/lighttick/today-focus/today-focus.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
const o = { appId: "lighttick" as const, userId: "focus-alice" };
export async function fixture(repo = new InMemoryLightTickRepository()) {
  let now = new Date("2026-11-15T08:00:00Z");
  const task = (id: string) => ({
    ...o,
    id,
    goalId: "g",
    planId: "p",
    title: id,
    status: "pending",
    version: 1,
    priority: 1,
    scheduledFor: "2026-11-15",
    estimatedMinutes: 10,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  // Only source facts are seeded; reads, transactions, versions and operations use the repository.
  repo.listGoals = async () => [
    { ...o, id: "g", status: "active", title: "Goal", version: 1 } as any,
  ];
  repo.listPlans = async () => [
    {
      ...o,
      id: "p",
      goalId: "g",
      status: "active",
      source: "manual_native",
      version: 1,
    } as any,
  ];
  let tasks = [task("task-a"), task("task-b")];
  repo.listTasks = async () => structuredClone(tasks) as any;
  repo.getTask = async (owner, id) =>
    owner.userId === o.userId
      ? (structuredClone(tasks.find((t) => t.id === id)) as any)
      : undefined;
  const today = new LightTickTodayService(repo, () => now),
    service = new TodayFocusService(repo, today, () => now);
  return {
    repo,
    today,
    service,
    setTime: (t: string) => (now = new Date(t)),
    complete: () => {
      tasks[1] = { ...tasks[1], status: "completed", version: 2 };
    },
    defer: () => {
      tasks[0] = { ...tasks[0], scheduledFor: "2026-11-16", version: 2 };
    },
  };
}
test("daily selection switches with CAS, replay is canonical, completion stays selected and next day resets", async () => {
  const f = await fixture();
  assert.equal((await f.service.current(o)).revision, 0);
  const body = {
    request_key: "select-task-b",
    base_version: 0,
    business_date: "2026-11-15",
    timezone: "UTC",
    task_id: "task-b",
    task_version: 1,
    success_criterion: "写完一段",
    first_step: "打开提纲",
  };
  const first = await f.service.select(o, body);
  assert.equal(first.status, "active");
  assert.equal(first.revision, 1);
  assert.deepEqual(
    await f.service.select(
      o,
      Object.fromEntries(Object.entries(body).reverse()),
    ),
    first,
  );
  await assert.rejects(
    f.service.select(o, {
      ...body,
      request_key: "stale-task-a",
      task_id: "task-a",
    }),
  );
  f.complete();
  assert.equal((await f.service.current(o)).status, "completed");
  assert.equal((await f.service.current(o)).task_id, "task-b");
  assert.equal(
    (
      await f.service.select(o, {
        ...body,
        request_key: "switch-task-a",
        base_version: 1,
        task_id: "task-a",
      })
    ).revision,
    2,
  );
  f.defer();
  assert.equal((await f.service.current(o)).status, "unavailable");
  f.setTime("2026-11-16T00:00:00Z");
  assert.equal((await f.service.current(o)).revision, 0);
  assert.deepEqual(await f.service.byRequest(o, body.request_key), first);
  await assert.rejects(
    f.service.select(o, { ...body, request_key: "old-day-reject" }),
  );
});
test("selection rejects foreign and non-today tasks; clearing uses CAS and rollback includes selection receipts", async () => {
  const f = await fixture(),
    body = {
      request_key: "select-first",
      base_version: 0,
      business_date: "2026-11-15",
      timezone: "UTC",
      task_id: "task-a",
      task_version: 1,
      success_criterion: "",
      first_step: "",
    };
  await assert.rejects(f.service.select(o, { ...body, task_id: "foreign" }));
  await assert.rejects(
    f.service.select(o, { ...body, timezone: "Asia/Shanghai" }),
  );
  await assert.rejects(
    f.repo.transaction(o, async () => {
      await f.service.select(o, body);
      throw Error("rollback");
    }),
  );
  assert.equal((await f.service.current(o)).revision, 0);
  await assert.rejects(f.service.byRequest(o, body.request_key));
  await f.service.select(o, body);
  const clear = await f.service.select(o, {
    ...body,
    request_key: "clear-focus",
    base_version: 1,
    task_id: null,
    task_version: null,
  });
  assert.equal(clear.status, "automatic");
  assert.equal(clear.revision, 2);
  await assert.rejects(
    f.service.byRequest({ ...o, userId: "other" }, body.request_key),
  );
});
test("a commit near midnight returns the selected business-day receipt without recomputing the day", async () => {
  const f = await fixture(),
    original = f.today.get.bind(f.today);
  let calls = 0;
  f.today.get = async (owner) => {
    calls++;
    const r = await original(owner);
    return calls === 1 ? r : { ...r, businessDate: "2026-11-16" };
  };
  const result = await f.service.select(o, {
    request_key: "midnight-selection",
    base_version: 0,
    business_date: "2026-11-15",
    timezone: "UTC",
    task_id: "task-a",
    task_version: 1,
    success_criterion: "",
    first_step: "",
  });
  assert.equal(result.business_date, "2026-11-15");
  assert.equal(result.status, "active");
  assert.equal(calls, 1);
});
