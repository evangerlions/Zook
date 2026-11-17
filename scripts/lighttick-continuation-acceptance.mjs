import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 跨日接续 API 级验收（GET /lighttick/goals/{id}/continuation）。
 *
 * 接续最容易「看起来能用、其实在骗人」的地方是容量口径：把「没超上限」说成
 * 「放得下」，而实际上有的任务根本没估算时长。所以这里不做形态断言就完事，
 * 而是造出三种真实情况，逐条核对接口有没有如实说出来：
 *   1. 当天已知投入 30 分钟、另有 1 件未估算，上限 10 分钟 → over_limit 必须为 true，
 *      unknown_count 必须为 1；
 *   2. 次日已知投入恰好等于上限 → over_limit 必须为 false（等于不等于超）；
 *   3. daily_limits 的 known_minutes 必须等于当天任务的预估（或实测）之和，
 *      且与 tasks 列表逐条对得上。
 *
 * 另外核对接续真正依赖的三条线索：
 *   - 任务血缘：替换后新任务的 lineage_id 指向起始任务（跨日接续链）；
 *   - 复盘来源：计划带回 source_reflection_id / version；
 *   - 做法保留：确认计划时 guidance 落到任务 notes，接续读回必须仍是原文。
 * 以及：缺参 400、倒序/超 31 天 422、未知目标 404、他人目标 404、未登录 401、
 * 读接口不产生任何写入。
 *
 * 依赖：API（默认 3100）。不需要 worker 与模型上游——本接口只读既有事实。
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_DEV_ACCOUNT_2（可选，用于跨账号 404 核对）
 *          LIGHTTICK_CONTINUATION_EVIDENCE
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const secondAccount = process.env.LIGHTTICK_DEV_ACCOUNT_2 ?? "";
const evidencePath = process.env.LIGHTTICK_CONTINUATION_EVIDENCE ?? "";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `continuation-e2e-${name}-${runId}`;

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

function localDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function login(who, pass) {
  const result = await request(`login ${who}`, "/api/v1/auth/login", {
    method: "POST",
    body: { appId: "lighttick", account: who, password: pass, clientType: "app" },
  });
  return result.data?.accessToken;
}

const token = await login(account, password);
assert.equal(typeof token, "string", "login must return an access token");

const day1 = localDate(0);
const day2 = localDate(1);

// 0. 未登录必须 401
await request("continuation without token", `/api/v1/lighttick/goals/anything/continuation?period_start=${day1}&period_end=${day2}`, {
  expected: [401],
});

// 1. 建目标 + 第一份计划（含未估算任务与做法提示）
const goal = (
  await request("create goal", "/api/v1/lighttick/goals", {
    method: "POST",
    token,
    idempotencyKey: operation("goal"),
    expected: [201],
    body: { title: `接续验收目标 ${runId}`, review_cadence: { layers: ["day"] } },
  })
).data;

const plan1 = (
  await request("create first plan", "/api/v1/lighttick/manual-plans", {
    method: "POST",
    token,
    idempotencyKey: operation("plan1"),
    expected: [200, 201],
    body: {
      goal_id: goal.id,
      title: `接续验收计划一 ${runId}`,
      completion_criteria: "第一天做两件",
      period_start: day1,
      period_end: day1,
      tasks: [
        {
          id: `a1-${runId}`,
          title: `接续任务甲 ${runId}`,
          scheduled_for: day1,
          estimated_minutes: 30,
          completion_criteria: "写出第一段",
          guidance: "先写一句，不要改稿",
        },
        {
          id: `a2-${runId}`,
          title: `接续任务乙 ${runId}`,
          scheduled_for: day1,
          estimated_minutes: null,
          completion_criteria: "",
          guidance: "",
        },
        {
          id: `a3-${runId}`,
          title: `接续任务丙 ${runId}`,
          scheduled_for: day1,
          estimated_minutes: 30,
          completion_criteria: "",
          guidance: "",
        },
      ],
    },
  })
).data;

const confirmed1 = (
  await request("confirm first plan", `/api/v1/lighttick/manual-plans/${plan1.id}/confirm`, {
    method: "POST",
    token,
    idempotencyKey: operation("confirm1"),
    expected: [200, 201],
    body: { base_version: plan1.version, goal_base_version: plan1.goal_version },
  })
).data;

const taskA = confirmed1.tasks.find((t) => t.title === `接续任务甲 ${runId}`);
const taskB = confirmed1.tasks.find((t) => t.title === `接续任务乙 ${runId}`);
const taskC = confirmed1.tasks.find((t) => t.title === `接续任务丙 ${runId}`);
assert.ok(taskA && taskB && taskC, "确认后计划应带回三条任务");
assert.equal(taskA.notes, "先写一句，不要改稿", "做法提示应落在任务 notes 上");
assert.equal(taskB.estimated_duration_minutes, null, "未估算任务必须保持 null，不能被补成 0");

// 2. 写复盘，再用它续排第二份计划（替换甲 → 新的丁，落在次日）
const reflectionId = `continuation-reflection-${runId}`;
const reflection = (
  await request("save reflection", `/api/v1/lighttick/reflections/${reflectionId}`, {
    method: "PUT",
    token,
    idempotencyKey: operation("reflection"),
    body: {
      goal_id: goal.id,
      period_start: day1,
      period_end: day1,
      content: `第一天只完成了丙，甲太长了 ${runId}`,
      next_action: "把甲拆成 10 分钟的一步",
      base_version: 0,
    },
  })
).data;
assert.equal(reflection.version, 1, "首次保存复盘版本应为 1");

const plan2 = (
  await request("create continuation plan", "/api/v1/lighttick/manual-plans", {
    method: "POST",
    token,
    idempotencyKey: operation("plan2"),
    expected: [200, 201],
    body: {
      goal_id: goal.id,
      title: `接续验收计划二 ${runId}`,
      completion_criteria: "次日只做一步",
      period_start: day2,
      period_end: day2,
      source_reflection_id: reflectionId,
      source_reflection_version: reflection.version,
      replace_tasks: [{ id: taskA.id, version: taskA.version }],
      tasks: [
        {
          id: `a4-${runId}`,
          source_task_id: taskA.id,
          title: `接续任务丁 ${runId}`,
          scheduled_for: day2,
          estimated_minutes: 10,
          completion_criteria: "只写一句",
          guidance: "只写一句就停",
        },
      ],
    },
  })
).data;

const confirmed2 = (
  await request("confirm continuation plan", `/api/v1/lighttick/manual-plans/${plan2.id}/confirm`, {
    method: "POST",
    token,
    idempotencyKey: operation("confirm2"),
    expected: [200, 201],
    body: { base_version: plan2.version, goal_base_version: plan2.goal_version },
  })
).data;
assert.equal(confirmed2.tasks.length, 1, "续排计划只应留下新任务");

// 3. 确认一个比已知投入更小的上限，检验接口是否如实报超
const before = (
  await request("read continuation before condition", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=${day1}&period_end=${day2}`, { token })
).data;
assert.equal(before.continuation_enabled, true, "本地应开启续排写入（LIGHTTICK_NATIVE_CONTINUATION_ENABLED!=0）");

const conditionId = `continuation-condition-${runId}`;
await request("confirm condition", `/api/v1/lighttick/goals/${goal.id}/conditions`, {
  method: "POST",
  token,
  idempotencyKey: operation("condition"),
  body: {
    id: conditionId,
    base_version: before.goal.version,
    condition_version: 0,
    scope: "ongoing",
    starts_on: day1,
    ends_on: null,
    daily_minutes: 10,
    active: true,
    reason: "验收：每天只有 10 分钟",
  },
});

const after = (
  await request("read continuation after condition", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=${day1}&period_end=${day2}`, { token })
).data;

// 4. 目标与窗口
assert.equal(after.goal.id, goal.id);
assert.equal(after.goal.title, `接续验收目标 ${runId}`, "接续读回的目标标题必须是目标自己的标题");
assert.ok(after.goal.version >= before.goal.version, "确认条件后目标版本不应倒退");
assert.equal(after.period_start, day1);
assert.equal(after.period_end, day2);
assert.equal(after.daily_limits.length, 2, "两天窗口应返回两天容量");

// 5. 条件与容量口径
assert.equal(after.conditions.length, 1, "应只有一条条件修订");
assert.equal(after.conditions[0].id, conditionId);
assert.equal(after.conditions[0].revision, 1);
assert.equal(after.conditions[0].active, true);
assert.equal(after.conditions[0].daily_minutes, 10);

const limitDay1 = after.daily_limits.find((d) => d.date === day1);
const limitDay2 = after.daily_limits.find((d) => d.date === day2);
assert.ok(limitDay1 && limitDay2, "容量必须逐日给出");

// known_minutes 必须等于当天任务的预估（或已完成任务的实测）之和
const expectedKnown = (date) =>
  after.tasks
    .filter((t) => t.scheduled_date === date && ["pending", "in_progress", "completed"].includes(t.status))
    .reduce((sum, t) => sum + (t.status === "completed" && t.actual_minutes !== null ? t.actual_minutes : (t.estimated_duration_minutes ?? 0)), 0);
const expectedUnknown = (date) =>
  after.tasks.filter((t) => t.scheduled_date === date && ["pending", "in_progress"].includes(t.status) && t.estimated_duration_minutes === null).length;

assert.equal(limitDay1.minutes, 10, "当天上限应取已确认条件");
assert.equal(limitDay2.minutes, 10, "持续条件应对次日同样生效");
assert.equal(limitDay1.known_minutes, expectedKnown(day1), "当天已排分钟必须等于任务预估之和");
assert.equal(limitDay2.known_minutes, expectedKnown(day2), "次日已排分钟必须等于任务预估之和");
assert.equal(limitDay1.unknown_count, expectedUnknown(day1), "未估算件数必须与任务列表一致");
assert.ok(limitDay1.unknown_count >= 1, "未估算任务必须被计为未知投入，而不是当成 0");
assert.equal(limitDay1.over_limit, limitDay1.known_minutes > limitDay1.minutes, "超出判定必须与已知投入一致");
assert.equal(limitDay1.over_limit, true, "已知投入超过上限时必须如实报超");
assert.equal(limitDay2.over_limit, false, "恰好等于上限不算超出");

// 6. 任务血缘与做法保留
const taskD = after.tasks.find((t) => t.title === `接续任务丁 ${runId}`);
const taskAafter = after.tasks.find((t) => t.id === taskA.id);
assert.ok(taskD, "续排后的新任务必须出现在接续上下文里");
assert.equal(taskD.lineage_id, taskA.id, "新任务的血缘必须指向起始任务");
assert.ok(taskAafter, "被替换的旧任务必须仍可读（历史保留）");
assert.notEqual(taskAafter.status, "pending", "被替换的旧任务不应仍为待做");
assert.equal(taskAafter.notes, "先写一句，不要改稿", "旧任务的做法提示必须原样保留");

// 7. 复盘与续排历史
assert.equal(after.reflections.length, 1, "应读回一份复盘");
assert.equal(after.reflections[0].id, reflectionId);
assert.equal(after.reflections[0].version, 1);
assert.ok(after.plans.length >= 2, "两次确认应留下两条计划历史");
const planWithSource = after.plans.find((p) => p.id === plan2.id);
assert.ok(planWithSource, "续排计划必须在历史里");
assert.equal(planWithSource.source_reflection_id, reflectionId, "计划必须带回复盘来源");
assert.equal(planWithSource.source_reflection_version, 1, "计划必须带回复盘版本");
assert.equal(planWithSource.period_start, day2);
assert.equal(planWithSource.status, "active");

// 8. 读接口不得写入
const reread = (
  await request("read continuation again", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=${day1}&period_end=${day2}`, { token })
).data;
assert.deepEqual(reread.tasks.map((t) => [t.id, t.version, t.status]), after.tasks.map((t) => [t.id, t.version, t.status]), "重复读取不应改变任何任务");

// 9. 参数与权限
await request("missing period_start", `/api/v1/lighttick/goals/${goal.id}/continuation?period_end=${day2}`, { token, expected: [400] });
await request("reversed window", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=${day2}&period_end=${day1}`, { token, expected: [422] });
await request("impossible date", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=2026-13-99&period_end=${day2}`, { token, expected: [400, 422] });
await request("window over 31 days", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=2026-01-01&period_end=2026-12-31`, { token, expected: [422] });
await request("unknown goal", `/api/v1/lighttick/goals/goal-does-not-exist/continuation?period_start=${day1}&period_end=${day2}`, { token, expected: [404] });

let crossOwner = "skipped: no LIGHTTICK_DEV_ACCOUNT_2";
if (secondAccount && secondAccount !== account) {
  const otherToken = await login(secondAccount, password);
  if (typeof otherToken === "string") {
    const response = await request("other owner goal", `/api/v1/lighttick/goals/${goal.id}/continuation?period_start=${day1}&period_end=${day2}`, {
      token: otherToken,
      expected: [404],
    });
    crossOwner = `404 (${response.code ?? "OK"})`;
  } else crossOwner = "skipped: second account login returned no token";
}

evidence.ok = true;
evidence.finished_at = new Date().toISOString();
evidence.summary = {
  goal_id: goal.id,
  window: [day1, day2],
  tasks: after.tasks.map((t) => ({ id: t.id, status: t.status, lineage_id: t.lineage_id, scheduled_date: t.scheduled_date, estimated: t.estimated_duration_minutes, actual: t.actual_minutes })),
  limits: after.daily_limits,
  conditions: after.conditions,
  plans: after.plans.map((p) => ({ id: p.id, status: p.status, period: [p.period_start, p.period_end], source_reflection: [p.source_reflection_id, p.source_reflection_version] })),
  cross_owner: crossOwner,
};

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nevidence written to ${evidencePath}`);
}
