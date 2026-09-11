import assert from "node:assert/strict";
import test from "node:test";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { assembleChatContext } from "../../src/modules/lighttick/ai/lighttick-ai-context.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_chat" };
const now = "2026-09-01T08:00:00.000Z";
let sequence = 0;
async function queuedChat(repository: InMemoryLightTickRepository, inputContext: Record<string, unknown>) {
  const row: LightTickAiRunRow = { ...owner, id: `lighttick_run_chat_${++sequence}`, kind: "coach_reply", status: "queued",
    sceneKey: "lighttick.coach_chat.v1", resourceId: undefined, promptVersion: "1.1.0", schemaVersion: "1.0.0",
    attemptCount: 0, inputContext, usage: {}, createdAt: now, updatedAt: now };
  return await repository.saveAiRun(row);
}

test("chat messages round-trip per thread in ascending order", async () => {
  const repository = new InMemoryLightTickRepository();
  const first = await repository.saveChatMessage({ ...owner, id: "m1", threadId: "goal-1", goalId: "goal-1",
    role: "user", content: "你好", createdAt: now });
  const second = await repository.saveChatMessage({ ...owner, id: "m2", threadId: "goal-1", goalId: "goal-1",
    role: "assistant", content: "你好！", createdAt: "2026-09-01T08:01:00.000Z" });
  assert.equal(first.role, "user");
  const list = await repository.listChatMessages(owner, "goal-1", 50);
  assert.deepEqual(list.map(message => message.id), ["m1", "m2"]);
  const other = await repository.listChatMessages(owner, "goal-other", 50);
  assert.equal(other.length, 0);
});

test("chat context includes goal, execution facts, and recent conversation only", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, () => new Date(now))
    .create(owner, { title: "通过 PMP 考试", constraints: {} });
  await repository.saveChatMessage({ ...owner, id: "m1", threadId: goal.id, goalId: goal.id,
    role: "user", content: "我最近效率低", createdAt: now });
  await repository.saveChatMessage({ ...owner, id: "m2", threadId: goal.id, goalId: goal.id,
    role: "assistant", content: "我们先看事实", createdAt: "2026-09-01T08:01:00.000Z" });
  const context = await assembleChatContext(repository, owner, { goal_id: goal.id, message: "怎么办" }, goal.id, 20);
  assert.equal(context.goal.title, "通过 PMP 考试");
  assert.equal(context.conversation.length, 2);
  assert.equal(context.conversation[0]!.role, "user");
  assert.equal(context.execution_facts.completed_count, 0);
  assert.equal(context.request.message, "怎么办");
  assert.equal(context.task, undefined);
});

test("chat context rejects missing or foreign goals", async () => {
  const repository = new InMemoryLightTickRepository();
  await assert.rejects(() => assembleChatContext(repository, owner, { goal_id: "missing" }, "missing", 20),
    (error: any) => error.code === "LIGHTTICK_RESOURCE_NOT_FOUND");
});

test("coach chat run persists user-visible assistant message and completes", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, () => new Date(now))
    .create(owner, { title: "坚持晨跑", constraints: {} });
  const run = await queuedChat(repository, { goal_id: goal.id, thread_id: goal.id,
    message: "我今天没力气跑步", coach_scene: "chat" });
  const llm = { complete: async () => ({ provider: "fake", modelKey: "fake", providerModel: "fake-v1",
    text: JSON.stringify({ message: "那就把今天的目标改成 5 分钟散步，先找回行动感。" }),
    usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } }) };
  const completed = await new LightTickAiRunner(repository, llm as any, () => new Date(now)).execute(owner, run.id, "coach_chat");
  assert.equal(completed.status, "succeeded");
  const messages = await repository.listChatMessages(owner, goal.id, 50);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.role, "assistant");
  assert.match(messages[0]!.content, /5 分钟散步/);
  assert.equal(messages[0]!.runId, run.id);
});

test("coach chat fallback still persists a factual-safe message", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, () => new Date(now))
    .create(owner, { title: "学习英语", constraints: {} });
  const run = await queuedChat(repository, { goal_id: goal.id, thread_id: goal.id,
    message: "解释一下计划", coach_scene: "chat" });
  const llm = { complete: async () => { throw new Error("provider outage"); } };
  const completed = await new LightTickAiRunner(repository, llm as any, () => new Date(now)).execute(owner, run.id, "coach_chat");
  assert.equal(completed.status, "succeeded");
  const messages = await repository.listChatMessages(owner, goal.id, 50);
  assert.equal(messages.length, 1);
  assert.match(messages[0]!.content, /AI 暂时不可用/);
});

test("user message stored at send time is excluded until the assistant replies", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, () => new Date(now))
    .create(owner, { title: "写作练习", constraints: {} });
  const userMessage = await repository.saveChatMessage({ ...owner, id: "user-1", threadId: goal.id, goalId: goal.id,
    role: "user", content: "帮我想想今天写什么", createdAt: now });
  assert.equal(userMessage.role, "user");
  const history = await repository.listChatMessages(owner, goal.id, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.content, "帮我想想今天写什么");
});
