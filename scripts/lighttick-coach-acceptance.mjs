import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * AI 教练（coach）API 级验收。
 *
 * 覆盖 Web 教练页真实发出的调用序列：
 *   goals -> chat/intents -> chat/messages -> coach-runs(chat, 202)
 *   -> runs/{id} 轮询 -> chat/messages（助手回复落库）
 *
 * 另外验一次「非对话场景」`coach-runs {scene:"task_breakdown"}`，
 * 它不写 chat 表，结果只在 run.result.message 里。
 *
 * 依赖：API（3100）+ worker（消费 lighttick.ai.run）+ 可用模型上游
 * （本机用 scripts/lighttick-llm-mock.mjs 在 8091 提供）。
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_COACH_EVIDENCE / LIGHTTICK_COACH_POLL_ATTEMPTS（默认 45）
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_COACH_EVIDENCE ?? "";
const pollAttempts = Number(process.env.LIGHTTICK_COACH_POLL_ATTEMPTS ?? 45);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const operation = (name) => `coach-e2e-${name}-${runId}`;
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

async function pollRun(token, id, label) {
  let run = { id, status: "queued" };
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (["succeeded", "failed"].includes(run.status)) break;
    await sleep(2000);
    run = (await request(label, `/api/v1/lighttick/runs/${id}`, { token })).data;
  }
  return run;
}

const login = await request("login", "/api/v1/auth/login", {
  method: "POST",
  body: { appId: "lighttick", account, password, clientType: "app" },
});
const token = login.data?.accessToken;
assert.equal(typeof token, "string", "login must return an access token");

const goal = (
  await request("create goal", "/api/v1/lighttick/goals", {
    method: "POST",
    token,
    idempotencyKey: operation("goal"),
    expected: [201],
    body: { title: `教练验收目标 ${runId}`, description: "AI 教练 E2E", review_cadence: { layers: ["day"] } },
  })
).data;
assert.equal(typeof goal?.id, "string");

// 1. 预设提问
const intents = await request("chat intents", "/api/v1/lighttick/chat/intents", { token });
const intentItems = intents.data?.intents ?? [];
record("intents", { count: intentItems.length, keys: intentItems.map((item) => item.key) });
assert.ok(intentItems.length >= 5, "产品预设提问应至少 5 条");
assert.ok(intentItems.every((item) => item.label && item.message), "每条预设都要有 label 与 message");

// 2. 空线程：先确认读得到（新目标应为 0 条）
const emptyThread = await request("chat messages (empty)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token });
assert.equal((emptyThread.data?.items ?? []).length, 0, "新目标的对话应为空");
assert.equal(emptyThread.data?.thread_id, goal.id, "线程默认等于 goal_id");

// 3. 发一条消息：202，用户消息已落库
const messageText = `这周任务太多，帮我减到两件（${runId}）`;
const chatKey = operation("chat");
const started = await request("coach chat run", "/api/v1/lighttick/coach-runs", {
  method: "POST",
  token,
  idempotencyKey: chatKey,
  expected: [202],
  body: { scene: "chat", goal_id: goal.id, message: messageText, thread_id: goal.id },
});
const chatRun = started.data;
assert.equal(typeof chatRun?.id, "string");
assert.equal(chatRun.thread_id, goal.id, "返回的 thread_id 应与请求一致");
assert.equal(typeof chatRun.message_id, "string", "用户消息应已落库并返回 id");
record("chat run accepted", { run_id: chatRun.id, thread_id: chatRun.thread_id, message_id: chatRun.message_id });

const afterSend = await request("chat messages (after send)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token });
const userMessage = (afterSend.data?.items ?? []).find((item) => item.id === chatRun.message_id);
assert.ok(userMessage, "用户消息必须能读回");
assert.equal(userMessage.role, "user");
assert.equal(userMessage.content, messageText);
record("user message", { count: afterSend.data.items.length });

// 4. 等助手回复：终态后必须能在对话里读到 assistant 消息
const settled = await pollRun(token, chatRun.id, "poll chat run");
assert.equal(settled.status, "succeeded", `chat run 应成功，实际 ${settled.status} ${settled.error_code ?? ""}`);

const afterReply = await request("chat messages (after reply)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token });
const items = afterReply.data?.items ?? [];
const assistant = items.find((item) => item.role === "assistant" && item.run_id === chatRun.id);
assert.ok(assistant, "助手回复必须以 assistant 消息落库，并带 run_id");
assert.ok(assistant.content.trim().length > 0, "助手回复不应为空");
record("assistant message", { count: items.length, chars: assistant.content.length });

// 5. 幂等：同 key 重放返回同一 run，且不会重复写用户消息
const replay = await request("replay chat run (same key)", "/api/v1/lighttick/coach-runs", {
  method: "POST",
  token,
  idempotencyKey: chatKey,
  expected: [202],
  body: { scene: "chat", goal_id: goal.id, message: messageText, thread_id: goal.id },
});
assert.equal(replay.data?.id, chatRun.id, "同一幂等键必须返回同一次运行");
const afterReplay = await request("chat messages (after replay)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token });
assert.equal(
  (afterReplay.data?.items ?? []).length,
  items.length,
  "重放同一次运行不得重复写用户消息",
);
record("idempotency", { run_id: chatRun.id, messages: afterReplay.data.items.length });

// 6. 超长消息必须被拒（前端上限 4000，后端也要兜住）
const tooLong = await request("reject oversized message", "/api/v1/lighttick/coach-runs", {
  method: "POST",
  token,
  idempotencyKey: operation("too-long"),
  expected: [400],
  body: { scene: "chat", goal_id: goal.id, message: "字".repeat(4001) },
});
record("oversized rejected", { status: tooLong.status, code: tooLong.code });

// 7. 非法场景必须被拒
const badScene = await request("reject unknown scene", "/api/v1/lighttick/coach-runs", {
  method: "POST",
  token,
  idempotencyKey: operation("bad-scene"),
  expected: [400],
  body: { scene: "make_me_happy", goal_id: goal.id },
});
record("unknown scene rejected", { status: badScene.status, code: badScene.code });

// 8. 非对话场景：结果只在 run.result.message，不写 chat 表
const before = (await request("chat messages (before scene)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token })).data?.items?.length ?? 0;
const sceneRun = (
  await request("coach scene run", "/api/v1/lighttick/coach-runs", {
    method: "POST",
    token,
    idempotencyKey: operation("scene"),
    expected: [202],
    body: { scene: "task_breakdown", goal_id: goal.id },
  })
).data;
const sceneSettled = await pollRun(token, sceneRun.id, "poll scene run");
assert.equal(sceneSettled.status, "succeeded", `场景运行应成功，实际 ${sceneSettled.status}`);
assert.equal(typeof sceneSettled.result?.message, "string", "非对话场景的结果应在 run.result.message");
const after = (await request("chat messages (after scene)", `/api/v1/lighttick/chat/messages?goal_id=${goal.id}&thread_id=${goal.id}&limit=50`, { token })).data?.items?.length ?? 0;
assert.equal(after, before, "非对话场景不得写入对话");
record("scene run", { status: sceneSettled.status, message_chars: sceneSettled.result.message.length, chat_unchanged: after === before });

evidence.finished_at = new Date().toISOString();
evidence.result = {
  ok: true,
  goal_id: goal.id,
  thread_id: chatRun.thread_id,
  chat_run_id: chatRun.id,
  chat_run_status: settled.status,
  messages: items.length,
  assistant_chars: assistant.content.length,
  intents: intentItems.length,
  scene_run_status: sceneSettled.status,
};
console.log("\n=== COACH E2E PASSED ===");
console.log(JSON.stringify(evidence.result, null, 1));

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${evidencePath}`);
}
