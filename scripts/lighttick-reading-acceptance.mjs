import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 阅读域 API 级验收。
 *
 * 这一域最容易「看起来能用、其实在骗人」的三处，逐条核对：
 *   1. 判重：同一篇文章带不同跟踪参数重复添加，必须落成一条，而不是两条；
 *   2. 读完：position_ratio=100 不得被当成读完，只有显式 completed 才写 completed_at；
 *   3. 每日选文：同一业务日重复读取必须完全一致（库变了也不变），候选不足时少给不凑数。
 * 另外核对两套独立 CAS：存位置不该让存反馈 409，反之亦然。
 *
 * 依赖：API（默认 3100）+ 真实 PostgreSQL。不需要 worker 与模型上游。
 *
 * 环境变量：LIGHTTICK_DEV_BASE_URL / LIGHTTICK_DEV_ACCOUNT / LIGHTTICK_DEV_PASSWORD
 *          LIGHTTICK_READING_EVIDENCE
 */

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT ?? "alice@example.com";
const password = process.env.LIGHTTICK_DEV_PASSWORD ?? "Password1234";
const evidencePath = process.env.LIGHTTICK_READING_EVIDENCE ?? "";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const evidence = { started_at: new Date().toISOString(), base_url: baseUrl, account, steps: [] };
function record(step, detail = {}) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`${step}: ${JSON.stringify(detail)}`);
}

async function request(label, path, { method = "GET", token, body, expected = [200] } = {}) {
  const headers = {
    accept: "application/json",
    "x-app-id": "lighttick",
    "x-client-platform": "web",
    "x-lighttick-task-schema": "2",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    record(`${label} FAILED`, { status: response.status, code: payload.code, message: payload.message });
    throw new Error(`${label} failed: HTTP ${response.status} ${payload.code ?? "UNKNOWN"} ${payload.message ?? ""}`.trim());
  }
  record(label, { status: response.status, code: payload.code ?? "OK" });
  return { status: response.status, data: payload.data, code: payload.code };
}

function localDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const login = await request("login", "/api/v1/auth/login", {
  method: "POST",
  body: { appId: "lighttick", account, password, clientType: "app" },
});
const token = login.data?.accessToken;
assert.equal(typeof token, "string", "login must return an access token");

const BASE = "/api/v1/lighttick/reading";
const date = localDate();

// 0. 未登录必须 401
await request("list without token", `${BASE}/articles`, { expected: [401] });

// 1. 判重：三种写法必须是同一篇
const canonical = `https://example.com/reading/${runId}/attention`;
const first = await request("create article", `${BASE}/articles`, {
  method: "POST", token, expected: [200, 201],
  body: {
    url: canonical, title: `注意力是稀缺资源 ${runId}`, source: "示例周刊",
    language: "zh", topic: "心理", summary: "摘要：注意力有限。",
    body: "全文第一段。\n全文第二段。", body_kind: "full",
  },
});
assert.equal(first.data.duplicate, false, "首次添加不应判为重复");
const articleId = first.data.article.id;
assert.equal(first.data.article.body_kind, "full");

const duplicate = await request("re-add with tracking params", `${BASE}/articles`, {
  method: "POST", token, expected: [200, 201],
  body: {
    url: `https://EXAMPLE.com/reading/${runId}/attention/?utm_source=twitter&utm_medium=social#top`,
    title: "标题不同也应判为同一篇", language: "zh",
  },
});
assert.equal(duplicate.data.duplicate, true, "带跟踪参数的同一链接必须判为重复");
assert.equal(duplicate.data.article.id, articleId, "重复时应返回已有那篇");

// 2. 详情：导读与反馈都还没有，位置为 0
const detail = (await request("detail", `${BASE}/articles/${articleId}`, { token })).data;
assert.equal(detail.guide, null, "还没生成导读");
assert.equal(detail.feedback, null, "还没写反馈");
assert.equal(detail.state.position_ratio, 0);
assert.equal(detail.state.completed_at, null);
assert.equal(detail.state.revision, 0, "未写过状态时 revision 应为 0");

// 3. 位置：滚到底也不等于读完
let state = (await request("save position 100", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 0, position_ratio: 100 },
})).data;
assert.equal(state.position_ratio, 100);
assert.equal(state.completed_at, null, "position_ratio=100 不得被当成读完");
assert.equal(state.revision, 1);
await request("stale position", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 0, position_ratio: 50 }, expected: [409],
});
// 位置允许回退
state = (await request("move position backwards", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 1, position_ratio: 40 },
})).data;
assert.equal(state.position_ratio, 40, "位置允许回退");
// 显式读完
state = (await request("explicit complete", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 2, completed: true },
})).data;
assert.equal(typeof state.completed_at, "string", "显式读完必须写 completed_at");
assert.equal(state.position_ratio, 40, "读完不应改动位置");
// 显式取消读完
state = (await request("uncomplete", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 3, completed: false },
})).data;
assert.equal(state.completed_at, null, "取消读完必须清空 completed_at");

// 4. 反馈：与位置各自 CAS，互不干扰
let feedback = (await request("save feedback", `${BASE}/articles/${articleId}/feedback`, {
  method: "PUT", token,
  body: { base_version: 0, value_rating: 4, difficulty: 2, takeaway: "注意力有限所以要主动排", tags: ["注意力", "注意力", "  "] },
})).data;
assert.equal(feedback.revision, 1);
assert.deepEqual(feedback.tags, ["注意力"], "标签必须去重并去掉空白");
await request("stale feedback", `${BASE}/articles/${articleId}/feedback`, {
  method: "PUT", token, body: { base_version: 0, takeaway: "冲突" }, expected: [409],
});
// 位置写入不应让反馈 409（两套独立 CAS）
await request("position does not block feedback", `${BASE}/articles/${articleId}/state`, {
  method: "PUT", token, body: { base_version: 4, position_ratio: 60 },
});
feedback = (await request("save feedback again", `${BASE}/articles/${articleId}/feedback`, {
  method: "PUT", token, body: { base_version: 1, question: "怎么判断一篇值不值得读？" },
})).data;
assert.equal(feedback.revision, 2);
assert.equal(feedback.takeaway, "注意力有限所以要主动排", "未传字段应保留原值");
assert.equal(feedback.value_rating, 4, "未传评分应保留原值");
await request("invalid rating", `${BASE}/articles/${articleId}/feedback`, {
  method: "PUT", token, body: { base_version: 2, value_rating: 9 }, expected: [422],
});

// 5. 搜索必须覆盖标签与反馈正文，而不是只搜标题
const byTag = (await request("search by tag", `${BASE}/articles?q=${encodeURIComponent("注意力")}`, { token })).data;
assert.ok(byTag.items.some((item) => item.id === articleId), "按标签应能搜到");
const byQuestion = (await request("search by feedback", `${BASE}/articles?q=${encodeURIComponent("值不值得读")}`, { token })).data;
assert.ok(byQuestion.items.some((item) => item.id === articleId), "按反馈正文应能搜到");
const noHit = (await request("search miss", `${BASE}/articles?q=${encodeURIComponent("绝对不存在的词")}`, { token })).data;
assert.equal(noHit.items.length, 0);
const withFeedback = (await request("filter with_feedback", `${BASE}/articles?filter=with_feedback`, { token })).data;
assert.ok(withFeedback.items.every((item) => item.has_feedback), "with_feedback 只能含有反馈的");
assert.ok(withFeedback.items.some((item) => item.id === articleId));

// 6. 每日选文：补足候选后必须稳定、去重、不拿读过的凑数
for (const [index, topic] of ["科技", "社会", "心理", "科技"].entries()) {
  await request(`seed candidate ${index}`, `${BASE}/articles`, {
    method: "POST", token, expected: [200, 201],
    body: { url: `https://example.com/reading/${runId}/cand-${index}`, title: `候选 ${index} ${runId}`, topic, language: "zh", summary: `候选摘要 ${index}` },
  });
}
const daily1 = (await request("daily first read", `${BASE}/daily?date=${date}`, { token })).data;
assert.equal(daily1.business_date, date);
assert.ok(daily1.items.length <= 3, "最多 3 篇");
assert.ok(daily1.items.length > 0, "候选存在时不应为空");
assert.equal(new Set(daily1.items.map((item) => item.id)).size, daily1.items.length, "同一天不得重复推荐");
assert.equal(daily1.shortfall, 3 - daily1.items.length, "shortfall 必须与实给篇数对得上");
assert.ok(daily1.items.every((item) => item.reason.length > 0), "每篇都要说明为什么选它");
assert.ok(daily1.items.every((item) => item.completed === false), "不得推荐已读完的");
const daily2 = (await request("daily second read", `${BASE}/daily?date=${date}`, { token })).data;
assert.deepEqual(daily2.items.map((item) => item.id), daily1.items.map((item) => item.id), "同一业务日必须稳定");
// 库变了，当天结果也不该变
await request("add article after daily", `${BASE}/articles`, {
  method: "POST", token, expected: [200, 201],
  body: { url: `https://example.com/reading/${runId}/late`, title: `后加的文章 ${runId}`, topic: "社会" },
});
const daily3 = (await request("daily after library change", `${BASE}/daily?date=${date}`, { token })).data;
assert.deepEqual(daily3.items.map((item) => item.id), daily1.items.map((item) => item.id), "当天已定的选文不因新增文章而变");

// 7. 更新与冲突
const patched = (await request("patch article", `${BASE}/articles/${articleId}`, {
  method: "PATCH", token, body: { base_version: detail.article.revision, topic: "认知" },
})).data;
assert.equal(patched.topic, "认知");
assert.equal(patched.body_kind, "full", "改主题不应动正文类型");
await request("stale patch", `${BASE}/articles/${articleId}`, {
  method: "PATCH", token, body: { base_version: detail.article.revision, topic: "冲突" }, expected: [409],
});

// 8. 参数与方法
await request("invalid url", `${BASE}/articles`, {
  method: "POST", token, body: { url: "javascript:alert(1)", title: "坏链接" }, expected: [422],
});
await request("missing title", `${BASE}/articles`, {
  method: "POST", token, body: { url: `https://example.com/x-${runId}` }, expected: [422],
});
await request("body kind mismatch", `${BASE}/articles`, {
  method: "POST", token, body: { url: `https://example.com/y-${runId}`, title: "无正文", body_kind: "full" }, expected: [422],
});
await request("bad filter", `${BASE}/articles?filter=nope`, { token, expected: [422] });
await request("bad daily date", `${BASE}/daily?date=2026-13-99`, { token, expected: [400] });
await request("wrong method on articles", `${BASE}/articles`, { method: "DELETE", token, expected: [405] });
await request("unknown article", `${BASE}/articles/does-not-exist`, { token, expected: [404] });

// 9. 删除：连带清掉状态与反馈
await request("delete article", `${BASE}/articles/${articleId}`, { method: "DELETE", token });
await request("deleted is gone", `${BASE}/articles/${articleId}`, { token, expected: [404] });

evidence.ok = true;
evidence.finished_at = new Date().toISOString();
evidence.summary = {
  article_id: articleId,
  daily: daily1.items.map((item) => ({ ordinal: item.ordinal, reason: item.reason, id: item.id })),
  shortfall: daily1.shortfall,
  tags_after_dedupe: feedback.tags,
  search_hits: { tag: byTag.items.length, feedback: byQuestion.items.length },
};

if (evidencePath) {
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nevidence written to ${evidencePath}`);
}
