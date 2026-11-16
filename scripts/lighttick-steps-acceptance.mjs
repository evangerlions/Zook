import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 「最小步骤」API 级验收。
 *
 * 验的是 Web 今日页 `tasks/{taskId}/steps/{stepId}` 这条真实调用链：
 *   目标 -> plan-runs(202, AI 计划) -> 轮询 runs/{id} -> plans/{id}(带 steps)
 *   -> confirm -> today(任务带 steps) -> 逐步勾选/取消 -> 幂等重放 -> 过期版本 409
 *
 * 为什么要走 AI 计划：步骤行只在 `lighttick-plan.service.ts` 按 AI 提案的
 * `tasks[].steps` 创建；手动计划没有步骤。所以本脚本依赖 worker + 可用模型上游
 * （本机用 `scripts/lighttick-llm-mock.mjs`）。
 *
 * 关键语义断言：步骤不参与任务完成判定——勾完全部步骤后任务仍是 pending。
 *
 * 环境变量：
 *   LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *   LIGHTTICK_STEPS_EVIDENCE    证据 JSON 路径
 *   LIGHTTICK_STEPS_POLL_ATTEMPTS 轮询次数（默认 45，每次 2s）
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_STEPS_EVIDENCE ?? "";
const pollAttempts = Number(process.env.LIGHTTICK_STEPS_POLL_ATTEMPTS ?? 45);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `steps-e2e-${name}-${runId}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const evidence = { started_at: new Date().toISOString(), base_url: baseUrl, account, steps: [] };
function record(step, detail = {}) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`${step}: ${JSON.stringify(detail)}`);
}

async function request(label, path, { method = "GET", token, body, idempotencyKey, expected = [200] } = {}) {
  const headers = {
    accept: "application/json",
    "x-app-id": "lighttick",
    "x-client-platform": "web",
    "x-lighttick-task-schema": "2",
    "x-grow-action-schema": "2",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    record(`${label} FAILED`, { status: response.status, code: payload.code, message: payload.message });
    throw new Error(`${label} failed: HTTP ${response.status} ${payload.code ?? "UNKNOWN"} ${payload.message ?? ""}`.trim());
  }
  record(label, { status: response.status, code: payload.code ?? "OK" });
  return { status: response.status, data: payload.data, code: payload.code, message: payload.message };
}

function businessDateIn(timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date, days) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

const login = await request("login", "/api/v1/auth/login", {
  method: "POST",
  body: { appId: "lighttick", account, password, clientType: "app" },
});
const token = login.data?.accessToken;
assert.equal(typeof token, "string", "login must return an access token");

const profile = await request("profile", "/api/v1/lighttick/profile", { token });
const timezone = profile.data?.timezone ?? "UTC";
const today = businessDateIn(timezone);
record("business date", { timezone, today });

const goal = (
  await request("create goal", "/api/v1/lighttick/goals", {
    method: "POST",
    token,
    idempotencyKey: operation("goal"),
    expected: [201],
    body: { title: `步骤验收目标 ${runId}`, description: "最小步骤 E2E", review_cadence: { layers: ["day"] } },
  })
).data;
assert.equal(typeof goal?.id, "string");

// 1. 让 AI 出一个带 steps 的计划
const started = await request("start plan run", "/api/v1/lighttick/plan-runs", {
  method: "POST",
  token,
  idempotencyKey: operation("plan-run"),
  expected: [202],
  body: { goal_id: goal.id, granularity: "week", period_start: today, period_end: addDays(today, 6) },
});
const planRun = started.data;
assert.equal(typeof planRun?.id, "string");

let run = planRun;
for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
  if (["succeeded", "failed"].includes(run.status)) break;
  await sleep(2000);
  run = (await request("poll plan run", `/api/v1/lighttick/runs/${planRun.id}`, { token })).data;
}
assert.ok(["succeeded", "failed"].includes(run.status), `plan run must settle, stayed ${run.status}`);
assert.equal(run.status, "succeeded", `plan run failed: ${run.error_code ?? "unknown"}`);
record("plan run settled", { status: run.status, result_resource_id: run.result_resource_id ?? null });

// 2. 提案里必须已经带 steps。注意：步骤行是在 **confirm** 时才落库
//    （lighttick-plan.service.ts 的 confirm 里按 proposal.tasks[].steps 建 step 行），
//    所以提案阶段只能从 plan.proposal.tasks 看，plans/{id}.tasks 此时还是空的。
const plans = await request("list plans", `/api/v1/lighttick/plans?goal_id=${goal.id}`, { token });
const plan = (plans.data?.items ?? []).find((item) => item.status === "proposed") ?? (plans.data?.items ?? [])[0];
assert.ok(plan, "a plan must exist for the goal");

const planDetail = await request("read plan", `/api/v1/lighttick/plans/${plan.id}`, { token });
const proposedTasks = planDetail.data?.proposal?.tasks ?? [];
const proposalTask = proposedTasks.find((task) => (task.steps ?? []).length > 0);
assert.ok(proposalTask, "the proposal must contain a task with steps");
record("proposed steps", {
  title: proposalTask.title,
  steps: proposalTask.steps,
});
assert.ok(proposalTask.steps.length >= 2, "mock plan should produce at least two steps");

// 3. 确认计划，任务与步骤落到今日
await request("confirm plan", `/api/v1/lighttick/plans/${plan.id}/confirm`, {
  method: "POST",
  token,
  idempotencyKey: operation("confirm"),
  body: { base_version: planDetail.data.version },
});

const todayView = await request("today", "/api/v1/lighttick/today", { token });
// 必须同时按 goal_id 过滤：不同次运行会生成同名任务（标题由 mock 固定），
// 只按标题找会命中历史任务，把别人的步骤状态当成自己的。
const todayTask = [...(todayView.data?.tasks ?? []), ...(todayView.data?.completed_tasks ?? [])].find(
  (task) => task.title === proposalTask.title && task.goal_id === goal.id,
);
assert.ok(todayTask, "the confirmed task must appear on today");
record("today task", { id: todayTask.id, status: todayTask.status, steps: (todayTask.steps ?? []).length });
assert.equal((todayTask.steps ?? []).length, proposalTask.steps.length, "today must render the same steps");
assert.ok((todayTask.steps ?? []).every((step) => step.completed === false), "new steps must start incomplete");

// 4. 勾选第一步：父任务版本 +1
const first = todayTask.steps[0];
const second = todayTask.steps[1];
const toggled = await request("complete step 1", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${first.id}`, {
  method: "POST",
  token,
  idempotencyKey: operation("step1-on"),
  body: { base_version: todayTask.version, completed: true },
});
assert.equal(toggled.data.steps.find((step) => step.id === first.id)?.completed, true, "step 1 must be completed");
assert.equal(toggled.data.version, todayTask.version + 1, "toggling a step must version the parent task");
record("step 1 on", { version: toggled.data.version, status: toggled.data.status });

// 5. 勾选第二步：必须用上一步返回的版本
const toggledAgain = await request("complete step 2", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${second.id}`, {
  method: "POST",
  token,
  idempotencyKey: operation("step2-on"),
  body: { base_version: toggled.data.version, completed: true },
});
assert.equal(toggledAgain.data.steps.filter((step) => step.completed).length, 2, "two steps must be completed");
record("step 2 on", { version: toggledAgain.data.version });

// 6. 取消第一步：可逆
const reverted = await request("revert step 1", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${first.id}`, {
  method: "POST",
  token,
  idempotencyKey: operation("step1-off"),
  body: { base_version: toggledAgain.data.version, completed: false },
});
assert.equal(reverted.data.steps.find((step) => step.id === first.id)?.completed, false, "step 1 must be reverted");
assert.equal(reverted.data.steps.filter((step) => step.completed).length, 1, "only step 2 stays completed");

// 7. 幂等：同一 key 重放必须返回第一次的结果，不得再涨版本。
//    注意比较对象是「同一个 key 的第一次响应」，不是上一个不同 key 的响应——
//    每个不同 key 都是一次新命令，都会给父任务 +1 版本（这是后端设计）。
const replayKey = operation("step1-off-replay");
const firstReplay = await request("revert step 1 (replay key)", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${first.id}`, {
  method: "POST",
  token,
  idempotencyKey: replayKey,
  body: { base_version: reverted.data.version, completed: false },
});
const secondReplay = await request("revert step 1 (same key again)", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${first.id}`, {
  method: "POST",
  token,
  idempotencyKey: replayKey,
  body: { base_version: reverted.data.version, completed: false },
});
assert.equal(
  secondReplay.data.version,
  firstReplay.data.version,
  "replaying the same idempotency key must return the first result, not bump the version again",
);
assert.equal(firstReplay.data.version, reverted.data.version + 1, "a new key is a new command and versions the task");
record("idempotency", { first_version: firstReplay.data.version, replay_version: secondReplay.data.version });

// 8. 过期版本必须被拒
const stale = await request("stale version rejected", `/api/v1/lighttick/tasks/${todayTask.id}/steps/${second.id}`, {
  method: "POST",
  token,
  idempotencyKey: operation("stale"),
  expected: [409],
  body: { base_version: todayTask.version, completed: false },
});
record("stale rejected", { status: stale.status, code: stale.code });
assert.equal(stale.code, "LIGHTTICK_VERSION_CONFLICT", "a stale base_version must be a version conflict");

// 9. 重新读取：步骤状态持久化，且任务仍未完成（步骤不改变完成判定）
const after = await request("today after toggles", "/api/v1/lighttick/today", { token });
const afterTask = [...(after.data?.tasks ?? []), ...(after.data?.completed_tasks ?? [])].find((task) => task.id === todayTask.id);
assert.ok(afterTask, "the task must still be listed after toggles");
const doneSteps = (afterTask.steps ?? []).filter((step) => step.completed);
assert.equal(doneSteps.length, 1, "exactly one step stays completed");
assert.equal(afterTask.status, "pending", "completing steps must not complete the task");
record("today after toggles", { status: afterTask.status, completed_steps: doneSteps.length, version: afterTask.version });

evidence.finished_at = new Date().toISOString();
evidence.result = {
  ok: true,
  goal_id: goal.id,
  plan_id: plan.id,
  task_id: todayTask.id,
  steps: proposalTask.steps.length,
  completed_steps: doneSteps.length,
  task_status: afterTask.status,
  version_after_toggles: afterTask.version,
};
console.log("\n=== STEPS E2E PASSED ===");
console.log(JSON.stringify(evidence.result, null, 1));

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${evidencePath}`);
}
