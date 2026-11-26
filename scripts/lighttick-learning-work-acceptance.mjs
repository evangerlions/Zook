import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * AI 课程生成（learning work）API 级验收。
 *
 * 覆盖 Web 学习页真实发出的调用序列：
 *   learning/authority -> learning/consent
 *   -> learning/work {kind:"route_draft"} -> 轮询 learning/work/{id}
 *   -> learning/work/{id}/adopt -> learning/routes/{id}/publish
 *   -> learning/work {kind:"lesson_draft"} -> 轮询 -> adopt（发布第 1 课）
 *
 * 为什么必须端到端跑：`route_draft` 的输出不是直接落库，而是先成为「未采纳草稿」，
 * 只有显式 adopt 才调用 routes.save 写入课程，publish 才产生正式版本。
 * 任何一环断开，前端都会表现为「生成了但课程没变」。
 *
 * 断言：
 *   1. 学习授权必须是 zook 阶段且已开读写同意（否则整条链路 403）
 *   2. 生成任务必须在有限轮询内到达终态（此前只记录不判定，会掩盖排队卡死）
 *   3. 大纲结构必须满足后端 courseDocument 约束：课时数 = 周次×频次、含 review
 *   4. adopt 前课程不存在；adopt 后 revision=1 且仍是 draft（未自动发布）
 *   5. publish 后 published_version=1、status=active、revision=2，且能读到版本快照
 *   6. 已采纳的草稿不得被二次采纳（409）；基线过期的生成请求不得创建任务（409）
 *   7. lesson_draft 采纳后第 1 课真实发布，路线 revision 递增
 *
 * 依赖：API（3100）+ worker（消费 lighttick.learning.work）+ 可用模型上游
 *      （本机用 scripts/lighttick-llm-mock.mjs 在 8091 提供 learning_route/learning_lesson）
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_LEARNING_EVIDENCE / LIGHTTICK_LEARNING_POLL_ATTEMPTS（默认 60）
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_LEARNING_EVIDENCE ?? "";
const pollAttempts = Number(process.env.LIGHTTICK_LEARNING_POLL_ATTEMPTS ?? 60);
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const routeId = `plan-course-${runId}`;
const operation = (name) => `learning-e2e-${name}-${runId}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const evidence = { started_at: new Date().toISOString(), base_url: baseUrl, account, route_id: routeId, steps: [] };
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

async function pollWork(token, id, label) {
  let work = { id, status: "queued" };
  let polls = 0;
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (["succeeded", "failed", "cancelled"].includes(work.status)) break;
    await sleep(2000);
    polls += 1;
    work = (await request(label, `/api/v1/lighttick/learning/work/${id}`, { token })).data;
  }
  // 只记录不判定会掩盖「任务一直排队」这类真实故障，这里必须硬断言到终态。
  assert.ok(
    ["succeeded", "failed", "cancelled"].includes(work.status),
    `learning work 必须在 ${pollAttempts} 轮内到达终态，实际停在 ${work.status}`,
  );
  return { work, polls };
}

const login = await request("login", "/api/v1/auth/login", {
  method: "POST",
  body: { appId: "lighttick", account, password, clientType: "app" },
});
const token = login.data?.accessToken;
assert.equal(typeof token, "string", "login must return an access token");

// 服务端生成链路必须走平台模型。账号若残留 personal 模式，工作会转本地生成并失败，
// 错误只会显示 LEARNING_OUTPUT_INVALID，验收会失去意义。这里显式纠正并留痕。
const modelSettings = (await request("model settings", "/api/v1/lighttick/ai/model-settings", { token })).data;
if (modelSettings.mode !== "platform") {
  await request("model settings platform", "/api/v1/lighttick/ai/model-settings", {
    method: "PUT",
    token,
    idempotencyKey: operation("model-platform"),
    body: { base_revision: modelSettings.revision, mode: "platform", base_url: null, model_name: null, api_key: null },
  });
  record("model mode switched to platform", { from: modelSettings.mode, revision: modelSettings.revision });
}

// 1. 学习授权：整条链路的前置条件
const authorityBefore = (await request("learning authority", "/api/v1/lighttick/learning/authority", { token })).data;
record("authority before", {
  phase: authorityBefore.phase,
  revision: authorityBefore.revision,
  reading_enabled: authorityBefore.reading_enabled,
  write_enabled: authorityBefore.write_enabled,
});
assert.equal(authorityBefore.phase, "zook", "学习能力必须处于 zook 阶段，否则生成链路不可用");
assert.equal(authorityBefore.write_enabled, true, "学习写入必须已启用");

let authority = authorityBefore;
if (!authority.reading_enabled) {
  const consent = (
    await request("learning consent", "/api/v1/lighttick/learning/consent", {
      method: "POST",
      token,
      idempotencyKey: operation("consent"),
      body: { base_revision: authority.revision, reading_enabled: true, private_enabled: false },
    })
  ).data;
  assert.equal(consent.revision, authority.revision + 1, "同意后 revision 必须递增");
  authority = { ...authority, ...consent };
  record("consent granted", { revision: consent.revision });
}
assert.equal(authority.reading_enabled, true, "读写同意必须已开启");

// 2. AI 生成课程大纲：新路线 base_revision=0
const brief = {
  title: `验收课程 ${runId}`,
  goal: "验证 AI 课程大纲能生成、被采纳并发布",
  level: "零基础",
  minutes: 30,
  pacing: "weekly",
  weeks: 1,
  sessions: 2,
};
const draftCreated = await request("create route draft", "/api/v1/lighttick/learning/work", {
  method: "POST",
  token,
  idempotencyKey: operation("route-draft"),
  expected: [200, 201, 202],
  body: { kind: "route_draft", route_id: routeId, base_revision: 0, brief },
});
const draftWorkId = draftCreated.data?.id;
assert.equal(typeof draftWorkId, "string", "生成任务必须返回 work id");
assert.equal(draftCreated.data.kind, "route_draft");
record("route draft accepted", { work_id: draftWorkId, status: draftCreated.data.status, http: draftCreated.status });

// 3. 等终态
const { work: draftWork, polls: draftPolls } = await pollWork(token, draftWorkId, "poll route draft");
assert.equal(
  draftWork.status,
  "succeeded",
  `大纲生成应成功，实际 ${draftWork.status} ${draftWork.error_code ?? ""}`,
);
assert.ok(draftWork.output_digest, "成功的草稿必须带 output_digest（采纳时要用）");
const document = draftWork.output?.document;
assert.ok(document && Array.isArray(document.lessons), "草稿输出必须包含课程文档");
const expectedLessons = brief.weeks * brief.sessions;
assert.equal(
  document.lessons.length,
  expectedLessons,
  `课时数必须等于周次×频次（${brief.weeks}×${brief.sessions}=${expectedLessons}）`,
);
assert.ok(document.lessons.some((lesson) => lesson.kind === "review"), "课程必须包含至少一个 review 课时");
assert.equal(
  document.lessons.filter((lesson) => lesson.number === undefined).length,
  0,
  "每节课都必须带 number",
);
record("route draft generated", {
  polls: draftPolls,
  lessons: document.lessons.length,
  review_lessons: document.lessons.filter((lesson) => lesson.kind === "review").length,
  scene_key: draftWork.output?.scene_key,
  provider: draftWork.output?.provider,
  model: draftWork.output?.model,
  prompt_version: draftWork.output?.prompt_version,
});

// 4. 采纳前课程不存在（证明「生成」不等于「已保存」）
const beforeAdopt = await request("route read before adopt", `/api/v1/lighttick/learning/routes/${routeId}`, {
  token,
  expected: [404],
});
record("route absent before adopt", { status: beforeAdopt.status, code: beforeAdopt.code });

// 5. 采纳草稿 -> 写入课程（仍是 draft，未自动发布）
const adopted = (
  await request("adopt route draft", `/api/v1/lighttick/learning/work/${draftWorkId}/adopt`, {
    method: "POST",
    token,
    idempotencyKey: operation("adopt-route"),
    body: {
      base_revision: draftWork.revision,
      base_route_revision: 0,
      expected_digest: draftWork.output_digest,
    },
  })
).data;
const savedRoute = adopted?.result;
assert.equal(savedRoute?.revision, 1, "首次采纳应把课程写到 revision 1");
assert.equal(savedRoute?.status, "draft", "采纳不得自动发布课程");
assert.equal(savedRoute?.published_version, 0, "采纳后仍应没有正式版本");
assert.equal(savedRoute?.document?.lessons?.length, expectedLessons, "落库的课时数应与草稿一致");
record("route adopted", { revision: savedRoute.revision, status: savedRoute.status, published_version: savedRoute.published_version });

// 6. 已采纳的草稿不能被二次采纳
const doubleAdopt = await request("reject double adopt", `/api/v1/lighttick/learning/work/${draftWorkId}/adopt`, {
  method: "POST",
  token,
  idempotencyKey: operation("adopt-route-again"),
  expected: [409],
  body: {
    base_revision: draftWork.revision,
    base_route_revision: 0,
    expected_digest: draftWork.output_digest,
  },
});
record("double adopt rejected", { status: doubleAdopt.status, code: doubleAdopt.code });

// 7. 基线过期不得创建生成任务（否则会覆盖别人已改的课程）
const staleDraft = await request("reject stale base revision", "/api/v1/lighttick/learning/work", {
  method: "POST",
  token,
  idempotencyKey: operation("route-draft-stale"),
  expected: [409],
  body: { kind: "route_draft", route_id: routeId, base_revision: 0, brief },
});
record("stale base rejected", { status: staleDraft.status, code: staleDraft.code });

// 8. 发布课程 -> 产生正式版本
const published = (
  await request("publish route", `/api/v1/lighttick/learning/routes/${routeId}/publish`, {
    method: "POST",
    token,
    idempotencyKey: operation("publish-route"),
    body: { base_revision: savedRoute.revision },
  })
).data;
assert.equal(published?.published_version, 1, "发布后应产生版本 1");
assert.equal(published?.status, "active", "发布后课程应变为 active");
assert.equal(published?.revision, savedRoute.revision + 1, "发布应让 revision 递增");
record("route published", {
  revision: published.revision,
  published_version: published.published_version,
  status: published.status,
});

// 9. 版本快照可读（发布产物不是只改了个标记）
const version = (
  await request("read published version", `/api/v1/lighttick/learning/routes/${routeId}/versions/1`, { token })
).data;
assert.equal(version?.version, 1);
assert.equal(version?.document?.lessons?.length, expectedLessons, "版本快照必须包含完整课时蓝图");
assert.equal(typeof version?.digest, "string", "版本快照必须带 digest");
record("version snapshot", { version: version.version, digest_chars: version.digest.length });

// 10. AI 生成第 1 课正文并发布
const lessonCreated = await request("create lesson draft", "/api/v1/lighttick/learning/work", {
  method: "POST",
  token,
  idempotencyKey: operation("lesson-draft"),
  expected: [200, 201, 202],
  body: {
    kind: "lesson_draft",
    route_id: routeId,
    base_revision: published.revision,
    number: 1,
    sources: [
      {
        kind: "text",
        title: "验收用来源",
        text: "最小可行练习：先把动作做出来 10 分钟，再决定要不要加量。记录开始与结束时间。",
      },
    ],
  },
});
const lessonWorkId = lessonCreated.data?.id;
assert.equal(typeof lessonWorkId, "string");
record("lesson draft accepted", { work_id: lessonWorkId, status: lessonCreated.data.status });

const { work: lessonWork, polls: lessonPolls } = await pollWork(token, lessonWorkId, "poll lesson draft");
assert.equal(
  lessonWork.status,
  "succeeded",
  `课时生成应成功，实际 ${lessonWork.status} ${lessonWork.error_code ?? ""}`,
);
const lessonContent = lessonWork.output?.content;
assert.equal(typeof lessonContent, "string", "课时草稿必须包含正文");
for (const section of ["引导问题", "概念", "示范", "边界", "练习", "参考分析", "自查", "记忆提示"]) {
  assert.ok(lessonContent.includes(section), `课时正文缺少教学小节：${section}`);
}
record("lesson draft generated", {
  polls: lessonPolls,
  content_chars: lessonContent.length,
  sections: 8,
  references_chars: (lessonWork.output?.references ?? "").length,
});

const lessonAdopted = (
  await request("adopt lesson draft", `/api/v1/lighttick/learning/work/${lessonWorkId}/adopt`, {
    method: "POST",
    token,
    idempotencyKey: operation("adopt-lesson"),
    body: {
      base_revision: lessonWork.revision,
      base_route_revision: published.revision,
      expected_digest: lessonWork.output_digest,
    },
  })
).data;
assert.equal(typeof lessonAdopted?.result?.id, "string", "采纳课时后必须返回课时 id");
assert.equal(lessonAdopted.result.route_revision, published.revision + 1, "发布课时应让路线 revision 递增");
record("lesson adopted", {
  lesson_id: lessonAdopted.result.id,
  content_version: lessonAdopted.result.content_version,
  route_revision: lessonAdopted.result.route_revision,
});

// 11. 课时已进入课程库
const lessons = (await request("list lessons", `/api/v1/lighttick/learning/lessons?limit=50`, { token })).data;
const publishedLesson = (lessons?.items ?? []).find((item) => item.id === lessonAdopted.result.id);
assert.ok(publishedLesson, "已发布的课时必须能在课程库里读到");
assert.equal(publishedLesson.number, 1);
record("lesson listed", { total: lessons.items.length, number: publishedLesson.number, title: publishedLesson.title });

evidence.finished_at = new Date().toISOString();
evidence.result = {
  ok: true,
  route_id: routeId,
  route_draft_work_id: draftWorkId,
  route_draft_polls: draftPolls,
  lessons: expectedLessons,
  route_revision_after_adopt: savedRoute.revision,
  published_version: published.published_version,
  route_status: published.status,
  lesson_draft_work_id: lessonWorkId,
  lesson_polls: lessonPolls,
  lesson_id: lessonAdopted.result.id,
  lesson_content_chars: lessonContent.length,
  route_revision_final: lessonAdopted.result.route_revision,
};
console.log("\n=== LEARNING WORK E2E PASSED ===");
console.log(JSON.stringify(evidence.result, null, 1));

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(`evidence written to ${evidencePath}`);
}
