import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickGoalWorkspaceService } from "../../src/modules/lighttick/lighttick-goal-workspace.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const alice = { appId: "lighttick", userId: "alice" } as const;
const clock = () => new Date("2026-11-19T08:00:00Z");

async function activeGoal(repository: InMemoryLightTickRepository) {
  const goals = new LightTickGoalService(repository, clock);
  const created = await goals.create(alice, { title: "跑通课程", constraints: {} });
  return goals.transition(alice, created.id, created.version, "resume");
}

test("milestones mode derives the target from the defined list", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await activeGoal(repository);
  const service = new LightTickGoalWorkspaceService(repository);

  const updated = await service.updateResult(alice, goal.id, {
    mode: "milestones",
    milestones: [
      { id: "m1", title: "写完第一课", completed: true, completed_at: "2026-11-18T10:00:00Z" },
      { id: "m2", title: "跑完一个完整循环", completed: false },
      { id: "m3", title: "复盘并调整节奏", completed: false },
    ],
  });

  assert.equal(updated.result.mode, "milestones");
  assert.equal(updated.result.target, 3, "目标数应等于里程碑条数，而不是 null");
  assert.equal(updated.result.current, 1);
  assert.equal(updated.result.percent, 33.3);
  assert.equal(updated.result.milestones?.length, 3);
  assert.equal(updated.result.milestones?.[0]?.completed_at, "2026-11-18T10:00:00Z");
});

test("milestones mode without a list and without existing milestones is rejected", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await activeGoal(repository);
  const service = new LightTickGoalWorkspaceService(repository);

  await assert.rejects(
    service.updateResult(alice, goal.id, { mode: "milestones" }),
    (error: any) => error.code === "REQ_FIELD_INVALID",
  );
});

test("switching back to milestones keeps an existing list", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await activeGoal(repository);
  const service = new LightTickGoalWorkspaceService(repository);

  await service.updateResult(alice, goal.id, {
    mode: "milestones",
    milestones: [{ id: "m1", title: "第一步", completed: true }],
  });
  const switched = await service.updateResult(alice, goal.id, { mode: "actions" });
  assert.equal(switched.result.mode, "actions");
  const back = await service.updateResult(alice, goal.id, { mode: "milestones" });
  assert.equal(back.result.target, 1);
  assert.equal(back.result.current, 1);
});

test("milestone input is normalised before it is stored", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await activeGoal(repository);
  const service = new LightTickGoalWorkspaceService(repository);

  const updated = await service.updateResult(alice, goal.id, {
    mode: "milestones",
    // 未完成的条目带完成时间会让进度与时间线矛盾，应被抹掉。
    milestones: [{ id: "m1", title: "  有空格  ", completed: false, completed_at: "2026-11-18T10:00:00Z" }],
  });
  assert.equal(updated.result.milestones?.[0]?.title, "有空格");
  assert.equal(updated.result.milestones?.[0]?.completed_at, undefined);

  await assert.rejects(
    service.updateResult(alice, goal.id, {
      mode: "milestones",
      milestones: [
        { id: "m1", title: "A", completed: false },
        { id: "m1", title: "B", completed: false },
      ],
    }),
    (error: any) => error.code === "REQ_FIELD_INVALID",
  );
  await assert.rejects(
    service.updateResult(alice, goal.id, {
      mode: "milestones",
      milestones: [{ id: "bad id!", title: "A", completed: false }],
    }),
    (error: any) => error.code === "REQ_FIELD_INVALID",
  );
});
