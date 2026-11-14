import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 周期复盘（review-runs）API 级验收。
 *
 * 验证的是 Web 端 `src/features/reviews/` 实际发出的调用序列：
 *   goals -> manual-plans -> confirm -> today -> tasks/start -> tasks/complete
 *   -> tasks/skip -> review-runs(202) -> reviews/{id}(事实立即可读) -> runs/{id}(轮询)
 *
 * 关键断言：
 *   1. 事实快照必须在 AI 完成之前就可读（界面"事实先出"的前提）。
 *   2. 同幂等键重放不得造出第二条 run / 第二份复盘。
 *   3. run 必须在轮询预算内落到终态；一直 queued 视为失败（说明没有 worker 消费）。
 *   4. 模型成功路径必须真的落 insights / recommendations；facts_only 兜底必须为空，不得伪造。
 *   5. 事实在 AI 结束后仍然存在。
 *
 * 依赖：API（默认 3100）+ worker（消费 lighttick.ai.run）+ 可用的模型上游。
 * 本机模型上游由 `scripts/lighttick-llm-mock.mjs` 在 8091 提供（见该文件说明）。
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_REVIEW_EVIDENCE ?? "";
const pollAttempts = Number(process.env.LIGHTTICK_REVIEW_POLL_ATTEMPTS ?? 15);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `review-e2e-${name}-${runId}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const evidence = { started_at: new Date().toISOString(), base_url: baseUrl, account, steps: [] };

function record(step, detail) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`${step}: ${JSON.stringify(detail)}`);
}

async function request(label, path, { method = "GET", token, body, idempotencyKey, expected = [200] } = {}) {
  // 与 Web 客户端 (src/shared/api/client.ts) 保持同样的头，否则 /today 会返回 426。
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
  return { status: response.status, data: payload.data, code: payload.code };
}

function businessDateIn(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
    body: {
      title: `复盘验收目标 ${runId}`,
      description: "周期复盘 E2E：验证事实先出与 AI 后到",
      review_cadence: { layers: ["day", "week"] },
    },
  })
).data;
assert.equal(typeof goal?.id, "string");

const taskA = `review-task-a-${runId}`;
const taskB = `review-task-b-${runId}`;
const plan = (
  await request("create manual plan", "/api/v1/lighttick/manual-plans", {
    method: "POST",
    token,
    idempotencyKey: operation("plan"),
    body: {
      goal_id: goal.id,
      title: `复盘验收计划 ${runId}`,
      completion_criteria: "两项任务各有明确结论",
      period_start: today,
      period_end: today,
      tasks: [
        {
          id: taskA,
          title: "完成一次复盘验收任务",
          scheduled_for: today,
          estimated_minutes: 30,
          completion_criteria: "确认完成",
          guidance: "直接打勾",
        },
        {
          id: taskB,
          title: "被跳过的一次任务",
          scheduled_for: today,
          estimated_minutes: 20,
          completion_criteria: "确认跳过",
          guidance: "直接跳过",
        },
      ],
    },
  })
).data;
assert.equal(typeof plan?.id, "string");

const confirmed = (
  await request("confirm plan", `/api/v1/lighttick/manual-plans/${plan.id}/confirm`, {
    method: "POST",
    token,
    idempotencyKey: operation("confirm"),
    body: { base_version: plan.version, goal_base_version: plan.goal_version },
  })
).data;

const confirmedTasks = confirmed?.tasks ?? [];
record("confirmed tasks", { count: confirmedTasks.length, ids: confirmedTasks.map((task) => task.id) });
assert.ok(confirmedTasks.length >= 2, "confirm must materialise both tasks");

// 服务端会重新生成任务 id，不能用提交时的草稿 id。
const recordA = confirmedTasks.find((task) => task.title === "完成一次复盘验收任务");
const recordB = confirmedTasks.find((task) => task.title === "被跳过的一次任务");
assert.ok(recordA && recordB, "both confirmed tasks must be identifiable by title");
const idA = recordA.id;
const idB = recordB.id;

const todayView = await request("today", "/api/v1/lighttick/today", { token });
const executable = [...(todayView.data?.tasks ?? []), ...(todayView.data?.completed_tasks ?? [])];
record("today", {
  business_date: todayView.data?.business_date,
  executable: executable.length,
});
assert.equal(todayView.data?.business_date, today, "today must match the profile business date");

function versionOf(id) {
  const found = executable.find((task) => task.id === id) ?? confirmedTasks.find((task) => task.id === id);
  assert.ok(found, `task ${id} must be visible`);
  return found.version;
}

const startedA = await request("start task A", `/api/v1/lighttick/tasks/${idA}/start`, {
  method: "POST",
  token,
  idempotencyKey: operation("start-a"),
  body: { base_version: versionOf(idA) },
});

await request("complete task A", `/api/v1/lighttick/tasks/${idA}/complete`, {
  method: "POST",
  token,
  idempotencyKey: operation("complete-a"),
  body: { base_version: startedA.data.version, actual_duration_minutes: 25 },
});

await request("skip task B", `/api/v1/lighttick/tasks/${idB}/skip`, {
  method: "POST",
  token,
  idempotencyKey: operation("skip-b"),
  body: { base_version: versionOf(idB), reason_code: "other" },
});

const reviewBody = { goal_id: goal.id, period: "daily", period_start: today, period_end: today };
const reviewKey = operation("review");
const started = await request("start review run", "/api/v1/lighttick/review-runs", {
  method: "POST",
  token,
  idempotencyKey: reviewKey,
  expected: [202],
  body: reviewBody,
});
const run = started.data;
assert.equal(typeof run?.id, "string");
assert.equal(typeof run?.result_resource_id, "string", "run must reference the review resource");

// 幂等：同一 key 重复提交必须返回同一次运行，而不是再造一份复盘。
const replay = await request("replay review run (same key)", "/api/v1/lighttick/review-runs", {
  method: "POST",
  token,
  idempotencyKey: reviewKey,
  expected: [202],
  body: reviewBody,
});
assert.equal(replay.data?.id, run.id, "replaying the same idempotency key must not create a second run");
record("idempotency", { run_id: run.id, replayed_run_id: replay.data?.id });

// 关键断言：AI 还没完成时，事实快照就必须可读。
const immediate = await request("review facts before AI", `/api/v1/lighttick/reviews/${run.result_resource_id}`, { token });
const facts = immediate.data?.facts ?? {};
record("immediate facts", {
  status: immediate.data?.status,
  event_count: facts.event_count,
  event_counts: facts.event_counts,
  data_sufficiency: immediate.data?.data_sufficiency,
  insights: Array.isArray(immediate.data?.insights) ? immediate.data.insights.length : null,
});
assert.ok(
  (facts.event_count ?? 0) >= 3,
  `facts must count start/complete/skip before AI finishes, got ${facts.event_count}`,
);
assert.equal(facts.event_counts?.task_complete, 1, "one completion must be recorded");
assert.equal(facts.event_counts?.task_skip, 1, "one skip must be recorded");
assert.equal(immediate.data?.data_sufficiency, "sufficient", "one terminal event is enough for a daily review");

const listed = await request("reviews list", "/api/v1/lighttick/reviews", { token });
assert.ok(
  (listed.data?.items ?? []).some((item) => item.id === run.result_resource_id),
  "the new review must appear in the history list",
);

let finalRun = run;
for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
  if (["succeeded", "failed"].includes(finalRun.status)) break;
  await sleep(2000);
  finalRun = (await request("poll run", `/api/v1/lighttick/runs/${run.id}`, { token })).data;
}
// 运行必须落到终态：一直 queued 说明没有 worker 消费，链路没被真正验证过。
assert.ok(
  ["succeeded", "failed"].includes(finalRun.status),
  `AI run must reach a terminal state within ${pollAttempts} polls, stayed ${finalRun.status}`,
);
const resultSource = finalRun.result?.source ?? "model";
record("final run", {
  status: finalRun.status,
  error_code: finalRun.error_code ?? null,
  retryable: finalRun.retryable,
  result_source: resultSource,
  attempts: pollAttempts,
});

const settled = await request("review after run", `/api/v1/lighttick/reviews/${run.result_resource_id}`, { token });
const insights = Array.isArray(settled.data?.insights) ? settled.data.insights : [];
const recommendations = Array.isArray(settled.data?.recommendations) ? settled.data.recommendations : [];
record("final review", {
  status: settled.data?.status,
  insights: insights.length,
  recommendations: recommendations.length,
});

assert.notEqual(settled.data?.status, "generating", "a terminal run must not leave the review generating");

// 两条路径分别断言：模型成功时必须真出洞察；兜底（facts_only）时必须空且不伪造内容。
if (finalRun.status === "succeeded" && resultSource !== "facts_only") {
  assert.ok(insights.length > 0, "a model-backed review run must persist insights");
  assert.ok(insights.every((item) => typeof item === "string" && item.trim()), "insights must be non-empty strings");
  assert.ok(recommendations.length > 0, "a model-backed review run must persist recommendations");
} else {
  assert.equal(insights.length, 0, "the facts_only fallback must not fabricate insights");
  assert.equal(recommendations.length, 0, "the facts_only fallback must not fabricate recommendations");
}

// 事实必须在 AI 结束后仍然存在，不能被覆盖掉。
assert.ok((settled.data?.facts?.event_count ?? 0) >= 3, "facts must survive the AI run");

evidence.finished_at = new Date().toISOString();
evidence.result = {
  ok: true,
  goal_id: goal.id,
  plan_id: plan.id,
  review_id: run.result_resource_id,
  run_status: finalRun.status,
  ai_result_source: resultSource,
  ai_error_code: finalRun.error_code ?? null,
  facts_event_count: settled.data?.facts?.event_count ?? 0,
  data_sufficiency: settled.data?.data_sufficiency ?? null,
  insights: insights.length,
  recommendations: recommendations.length,
};
console.log("\n=== E2E PASSED ===");
console.log(JSON.stringify(evidence.result, null, 1));

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${evidencePath}`);
}
