import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 两个遗留缺陷的运行时回归（API 级）。
 *
 * 缺陷 1：确认手动计划时用计划标题覆盖目标标题
 *   `ManualPlanningService.confirm` 曾执行 `goal.title = draft.title`，
 *   于是每确认一个周计划都会把目标改名，目标再也无法按用户输入的原标题检索。
 *   修复后：目标标题保持不变，计划标题只留在 `plan.proposal.draft.title`。
 *
 * 缺陷 2：`validateReviewOutput` 比合同更严
 *   合同 `LightTickReviewActionView.recommendations` 是 `oneOf[string, object]`，
 *   旧校验只接受字符串，真实模型给对象时被判 502 并整体降级为 `facts_only`。
 *   修复后：对象形态能通过校验，run 落到 `succeeded` 且 `result.source === "model"`。
 *
 * 依赖：API（3100）+ worker（消费 lighttick.ai.run）+ 模型上游。
 * 本机由 `scripts/lighttick-llm-mock.mjs` 在 8091 提供；
 * 要覆盖对象形态，需 `LIGHTTICK_LLM_MOCK_RECOMMENDATIONS=mixed`（默认值）。
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_DEFECT_EVIDENCE / LIGHTTICK_DEFECT_POLL_ATTEMPTS（默认 45）
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_DEFECT_EVIDENCE ?? "";
const pollAttempts = Number(process.env.LIGHTTICK_DEFECT_POLL_ATTEMPTS ?? 45);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `defect-e2e-${name}-${runId}`;
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

/* ---------------- 缺陷 1：目标标题不被计划标题覆盖 ---------------- */

const goalTitle = `缺陷验收目标 ${runId}`;
const planTitle = `缺陷验收计划 ${runId}`;
const date = todayLocal();

const goal = (
  await request("create goal", "/api/v1/lighttick/goals", {
    method: "POST",
    token,
    idempotencyKey: operation("goal"),
    expected: [201],
    body: { title: goalTitle, description: "目标标题保留验收", review_cadence: { layers: ["day"] } },
  })
).data;
assert.equal(goal?.title, goalTitle, "创建后目标标题应等于输入");

const draft = (
  await request("create manual plan", "/api/v1/lighttick/manual-plans", {
    method: "POST",
    token,
    idempotencyKey: operation("plan"),
    expected: [200, 201],
    body: {
      goal_id: goal.id,
      title: planTitle,
      completion_criteria: "今天完成一件",
      period_start: date,
      period_end: date,
      tasks: [
        {
          id: `t1-${runId}`,
          title: `缺陷验收任务 ${runId}`,
          scheduled_for: date,
          estimated_minutes: 15,
          completion_criteria: "写下一条",
          guidance: "先写一句",
        },
      ],
    },
  })
).data;
assert.equal(draft?.draft?.title, planTitle, "草稿应保存计划标题");

await request("confirm plan", `/api/v1/lighttick/manual-plans/${draft.id}/confirm`, {
  method: "POST",
  token,
  idempotencyKey: operation("confirm"),
  expected: [200, 201],
  body: { base_version: draft.version, goal_base_version: draft.goal_version },
});

const goalAfter = (await request("read goal after confirm", `/api/v1/lighttick/goals/${goal.id}`, { token })).data;
assert.equal(goalAfter.title, goalTitle, "确认计划不得改写目标标题");
assert.equal(goalAfter.status, "active", "草稿目标确认后应激活");

const planAfter = (await request("read plan after confirm", `/api/v1/lighttick/manual-plans/${draft.id}`, { token })).data;
assert.equal(planAfter?.draft?.title, planTitle, "计划标题应保留在计划自身上");
record("goal title preserved", { goal_title: goalAfter.title, plan_title: planAfter.draft.title });

/* ---------------- 缺陷 2：对象形态的建议不得被判 502 ---------------- */

const reviewRun = (
  await request("create review run", "/api/v1/lighttick/review-runs", {
    method: "POST",
    token,
    idempotencyKey: operation("review"),
    expected: [202],
    body: { period: "daily", goal_id: goal.id, period_start: date, period_end: date },
  })
).data;
assert.equal(typeof reviewRun?.id, "string", "review run 必须返回 id");
assert.equal(typeof reviewRun?.result_resource_id, "string", "review run 必须指向复盘资源");

let finalRun = reviewRun;
for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
  if (["succeeded", "failed"].includes(finalRun.status)) break;
  await sleep(2000);
  finalRun = (await request("poll review run", `/api/v1/lighttick/runs/${reviewRun.id}`, { token })).data;
}
assert.ok(
  ["succeeded", "failed"].includes(finalRun.status),
  `review run 必须在 ${pollAttempts} 次轮询内落到终态，实际 ${finalRun.status}`,
);
assert.equal(finalRun.status, "succeeded", `review run 应成功，实际 ${finalRun.status} ${finalRun.error_code ?? ""}`);

const resultSource = finalRun.result?.source ?? "model";
record("review run terminal", { status: finalRun.status, source: resultSource, error_code: finalRun.error_code ?? null });
assert.equal(
  resultSource,
  "model",
  "对象形态的建议必须走模型路径；落到 facts_only 说明校验仍然比合同严",
);

const runRecommendations = finalRun.result?.recommendations ?? [];
assert.ok(runRecommendations.length > 0, "模型路径必须返回建议");
const objectItems = runRecommendations.filter((item) => item && typeof item === "object" && !Array.isArray(item));
assert.ok(objectItems.length > 0, "本轮 mock 返回 mixed 形态，必须至少包含一条对象建议");
assert.ok(
  objectItems.every((item) => typeof item.title === "string" && item.title.trim()),
  "对象建议必须带可展示的 title",
);
record("object recommendations accepted", {
  total: runRecommendations.length,
  objects: objectItems.length,
  titles: objectItems.map((item) => item.title),
});

// 复盘资源必须把原始对象形态回给前端（前端 parseRecommendations 两种都吃）
const reviewAfter = (await request("read review after run", `/api/v1/lighttick/reviews/${reviewRun.result_resource_id}`, { token })).data;
const persisted = reviewAfter?.recommendations ?? [];
assert.ok(
  persisted.some((item) => item && typeof item === "object" && !Array.isArray(item)),
  "复盘资源应保留对象形态的建议",
);
record("review resource keeps object shape", {
  count: persisted.length,
  shapes: persisted.map((item) => (typeof item === "string" ? "string" : "object")),
});

evidence.ok = true;
evidence.finished_at = new Date().toISOString();
evidence.summary = {
  goal_title_before: goalTitle,
  goal_title_after: goalAfter.title,
  plan_title: planAfter.draft.title,
  review_run_status: finalRun.status,
  review_result_source: resultSource,
  recommendation_shapes: persisted.map((item) => (typeof item === "string" ? "string" : "object")),
};

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nevidence written to ${evidencePath}`);
}

console.log("\n=== DEFECT FIX E2E PASSED ===");
console.log(JSON.stringify(evidence.summary, null, 1));
