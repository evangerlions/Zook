import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 成长总览 API 级验收（GET /lighttick/growth/overview）。
 *
 * 聚合最容易犯的错是「数字和列表对不上」，所以这里不做形态断言就完事，
 * 而是用一条真实任务做增量核对：
 *   1. 取基线总览；
 *   2. 造计划 → 确认 → 开始 → 完成（实测 30 分钟）；
 *   3. 再取总览，断言「完成件数 +1、时长 +30」**恰好**发生，
 *      且热力图当天格子同步 +1/+30。
 * 另外验：日期与窗口参数可复现、非法参数 400、未登录 401。
 *
 * 依赖：API（默认 3100）。不需要 worker 与模型上游——本接口只做事实聚合。
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_GROWTH_EVIDENCE
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_GROWTH_EVIDENCE ?? "";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `growth-e2e-${name}-${runId}`;

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

function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const login = await request("login", "/api/v1/auth/login", {
  method: "POST",
  body: { appId: "lighttick", account, password, clientType: "app" },
});
const token = login.data?.accessToken;
assert.equal(typeof token, "string", "login must return an access token");

// 0. 未登录必须 401
await request("overview without token", "/api/v1/lighttick/growth/overview", { expected: [401] });

const date = todayLocal();
const overviewPath = `/api/v1/lighttick/growth/overview?date=${date}`;

// 1. 基线
const baseline = (await request("baseline overview", overviewPath, { token })).data;
assert.equal(typeof baseline?.today, "string");
assert.equal(baseline.today, date, "date 参数应可复现指定业务日");
assert.equal(baseline.week.days.length, 7, "本周必须有 7 天");
assert.equal(baseline.recent.days.length, 7, "近 7 天必须有 7 天");
assert.equal(baseline.heatmap.days.length, 120, "默认热力图窗口为 120 天");
assert.equal(baseline.heatmap.days.at(-1).date, date, "热力图必须以业务日结束");
const baselineDay = baseline.heatmap.days.find((day) => day.date === date);
assert.ok(baselineDay, "热力图必须包含业务日");
record("baseline", {
  completed: baseline.totals.completed,
  minutes: baseline.totals.minutes,
  week_completed: baseline.week.completed,
  today_completed: baselineDay.completed,
  today_minutes: baselineDay.minutes,
});

// 2. 造一条今天到期的任务并完成它
const goal = (
  await request("create goal", "/api/v1/lighttick/goals", {
    method: "POST",
    token,
    idempotencyKey: operation("goal"),
    expected: [201],
    body: { title: `成长验收目标 ${runId}`, review_cadence: { layers: ["day"] } },
  })
).data;

const draft = (
  await request("create manual plan", "/api/v1/lighttick/manual-plans", {
    method: "POST",
    token,
    idempotencyKey: operation("plan"),
    expected: [200, 201],
    body: {
      goal_id: goal.id,
      title: `成长验收计划 ${runId}`,
      completion_criteria: "今天完成一件",
      period_start: date,
      period_end: date,
      tasks: [
        {
          id: `t1-${runId}`,
          title: `成长验收任务 ${runId}`,
          scheduled_for: date,
          estimated_minutes: 20,
          completion_criteria: "写下一条",
          guidance: "先写一句",
        },
      ],
    },
  })
).data;

await request("confirm plan", `/api/v1/lighttick/manual-plans/${draft.id}/confirm`, {
  method: "POST",
  token,
  idempotencyKey: operation("confirm"),
  expected: [200, 201],
  body: { base_version: draft.version, goal_base_version: draft.goal_version },
});

const today = (await request("read today", `/api/v1/lighttick/today?date=${date}`, { token })).data;
const task = (today?.tasks ?? []).find((item) => item.title === `成长验收任务 ${runId}`);
assert.ok(task, "确认后今天应能读到刚建的任务");

const started = await request("start task", `/api/v1/lighttick/tasks/${task.id}/start`, {
  method: "POST",
  token,
  idempotencyKey: operation("start"),
  body: { base_version: task.version },
});
await request("complete task", `/api/v1/lighttick/tasks/${task.id}/complete`, {
  method: "POST",
  token,
  idempotencyKey: operation("complete"),
  body: { base_version: started.data.version, actual_duration_minutes: 30 },
});

// 3. 增量必须恰好为 +1 件 / +30 分钟（实测优先于预估的 20 分钟）
const after = (await request("overview after completion", overviewPath, { token })).data;
const afterDay = after.heatmap.days.find((day) => day.date === date);
assert.equal(afterDay.completed, baselineDay.completed + 1, "当天完成件数应恰好 +1");
assert.equal(afterDay.minutes, baselineDay.minutes + 30, "当天时长应按实测 +30，而不是预估 +20");
assert.equal(after.totals.completed, baseline.totals.completed + 1, "总完成件数应恰好 +1");
assert.equal(after.totals.minutes, baseline.totals.minutes + 30, "总时长应恰好 +30");
assert.equal(after.week.completed, baseline.week.completed + 1, "本周完成件数应恰好 +1");
assert.equal(after.week.minutes, baseline.week.minutes + 30, "本周时长应恰好 +30");
record("increment verified", {
  day_completed: [baselineDay.completed, afterDay.completed],
  day_minutes: [baselineDay.minutes, afterDay.minutes],
  totals_completed: [baseline.totals.completed, after.totals.completed],
});

// 4. 窗口参数
const shortWindow = (await request("short window", `${overviewPath}&days=30`, { token })).data;
assert.equal(shortWindow.heatmap.days.length, 30, "days=30 应返回 30 天窗口");
assert.equal(shortWindow.heatmap.start, shortWindow.heatmap.days[0].date);

// 5. 非法参数
await request("invalid date", "/api/v1/lighttick/growth/overview?date=2026-13-99", { token, expected: [400] });
await request("invalid days (0)", `${overviewPath}&days=0`, { token, expected: [400] });
await request("invalid days (999)", `${overviewPath}&days=999`, { token, expected: [400] });
await request("invalid method", "/api/v1/lighttick/growth/overview", { method: "POST", token, body: {}, expected: [405] });

evidence.ok = true;
evidence.finished_at = new Date().toISOString();
evidence.summary = {
  date,
  baseline_totals: baseline.totals,
  after_totals: after.totals,
  today_bucket: { before: baselineDay, after: afterDay },
  heatmap_days: after.heatmap.days.length,
  week: { start: after.week.start, end: after.week.end },
};

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nevidence written to ${evidencePath}`);
}

console.log("\n=== GROWTH OVERVIEW E2E PASSED ===");
console.log(JSON.stringify(evidence.summary, null, 1));
