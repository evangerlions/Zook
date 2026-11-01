import assert from "node:assert/strict";
import test from "node:test";
import { aiNovelAutoFreeActive, parseAiNovelAutoFreeConfig } from "../../src/shared/ai-novel-auto-free.ts";
import { normalizeAiNovelModelSelectionAdminInput } from "../../src/modules/ai-novel/ai-novel-model-selection-config.ts";
import { parseAiNovelModelSelectionText } from "../../apps/admin-web/app/lib/ai-novel-model-selection.ts";
import { AiNovelCreditsRequestFlow } from "../../src/modules/ai-novel/credits/ai-novel-credits-request-flow.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";
import { createApplication } from "../support/create-test-application.ts";

const config = { schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] } };
test("campaign is opt-in, start-inclusive/end-exclusive, with optional dates and shared validation", () => {
  const active = { enabled: true, startsAt: "2026-10-21T00:00:00Z", endsAt: "2026-10-22T00:00:00Z" };
  for (const [at, expected] of [["2026-10-20T23:59:59Z", false], [active.startsAt, true], [active.endsAt, false]] as const) {
    assert.equal(aiNovelAutoFreeActive(active, new Date(at)), expected);
  }
  assert.equal(aiNovelAutoFreeActive(undefined), false);
  assert.equal(aiNovelAutoFreeActive({ enabled: false }), false);
  assert.equal(aiNovelAutoFreeActive({ enabled: true }), true);
  const normalized = parseAiNovelAutoFreeConfig(active);
  assert.deepEqual(normalizeAiNovelModelSelectionAdminInput({ ...config, autoFree: active }).autoFree, normalized);
  assert.deepEqual(parseAiNovelModelSelectionText(JSON.stringify({ ...config, autoFree: active }), ["qwen3.6-plus"]).autoFree, normalized);
  for (const invalid of [{ enabled: "true" }, { enabled: true, endsAt: "2026-10-21" },
    { enabled: true, startsAt: "2026-02-30T00:00:00Z" },
    { ...active, startsAt: active.endsAt }, { ...active, extra: true }]) {
    assert.throws(() => parseAiNovelAutoFreeConfig(invalid));
    assert.throws(() => normalizeAiNovelModelSelectionAdminInput({ ...config, autoFree: invalid }));
    assert.throws(() => parseAiNovelModelSelectionText(JSON.stringify({ ...config, autoFree: invalid }), ["qwen3.6-plus"]));
  }
});

test("Auto bypasses zero balance, manual/embedding cannot; new requests honor manual switch", async () => {
  let active = true;
  const credits = new AiNovelCreditsService(new InMemoryAiNovelCreditsStore(), async () => "free");
  await credits.begin("u", "exhaust", "r0");
  await credits.record("u", "exhaust", "r0", { callId: "cost", modelKey: "m", pointMicros: "200000000",
    pricing: { inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 400 },
    usage: { promptTokens: 2_000_000, completionTokens: 0, totalTokens: 2_000_000 } });
  await credits.releaseRequest("u", "exhaust", "r0");
  const flow = new AiNovelCreditsRequestFlow(credits, true, undefined, async () => active);
  const body = { sceneKey: "write_turn", messages: [{ role: "user", content: "hello" }] };
  const opts = { userId: "u", requestId: "r1" };
  const response = { sceneKey: "write_turn", completion: { sceneRouteKey: "write_turn", provider: "test", providerModel: "m", content: "ok", finishReason: "stop" } };
  for (const selection of [undefined, { mode: "auto" }]) {
    assert.equal(await flow.complete({ ...body, modelSelection: selection }, opts, async options => {
      assert.equal(options.onUsageFinalized, undefined);
      return response;
    }), response);
    const events = [];
    for await (const event of flow.stream({ ...body, modelSelection: selection }, opts, async function* (options) {
      assert.equal(options.onUsageFinalized, undefined);
      yield { type: "content_delta", text: "free" };
    })) events.push(event);
    assert.equal(events[0]?.type, "content_delta");
  }
  assert.equal((await credits.balanceMicros("u")).remainingMicros, "0");
  await assert.rejects(flow.complete({ ...body, modelSelection: { mode: "manual", modelKey: "m" } }, opts, async () => response));
  await assert.rejects(flow.embeddings({ sceneKey: "memory_embedding", input: ["hello"] }, opts, async () => { throw Error("must not execute"); }));
  await assert.rejects(flow.complete({ ...body, modelSelection: { mode: "auto", free: true } }, opts, async () => response));
  active = false;
  await assert.rejects(flow.complete(body, opts, async () => response));
});

test("HTTP admin save/restore persists the campaign through the existing revision path", async () => {
  const runtime = await createApplication({ adminBasicAuth: { username: "admin", password: "AdminPass123!" } });
  const path = "/api/v1/admin/apps/ai_novel/model-selection";
  const headers = { authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}` };
  const update = (autoFree: unknown) => runtime.app.handle({ method: "PUT", path, headers, body: { config: { ...config, autoFree }, desc: "campaign" } });
  assert.equal((await runtime.app.handle({ method: "PUT", path, headers: {}, body: { config } })).statusCode, 401);
  assert.equal((await update({ enabled: true, startsAt: "wrong" })).statusCode, 400);
  const first = await update({ enabled: true });
  assert.equal(first.statusCode, 200);
  const revision = (first.body as any).data.revision;
  assert.equal((await update({ enabled: false })).statusCode, 200);
  assert.equal((await runtime.services.aiNovelModelSelectionConfigService.getAutoFree()).active, false);
  assert.equal((await runtime.app.handle({ method: "POST", path: `${path}/revisions/${revision}/restore`, headers, body: {} })).statusCode, 200);
  assert.equal((await runtime.services.aiNovelModelSelectionConfigService.getAutoFree()).active, true);
});

test("free admission retains request validation, concurrency lease and in-flight policy snapshot", async () => {
  let active = true;
  const credits = new AiNovelCreditsService(new InMemoryAiNovelCreditsStore(), async () => "free");
  const flow = new AiNovelCreditsRequestFlow(credits, true, undefined, async () => active);
  const body = { sceneKey: "write_turn", messages: [{ role: "user", content: "hello" }] };
  const opts = { userId: "u", requestId: "free" };
  const response = { sceneKey: "write_turn", completion: { sceneRouteKey: "write_turn", provider: "test", providerModel: "m", content: "ok", finishReason: "stop" } };
  await assert.rejects(flow.complete(body, {}, async () => response), /authenticated user/);
  await assert.rejects(flow.complete({ ...body, messages: [] }, opts, async () => response));
  const stream = flow.stream(body, opts, async function* () {
    yield { type: "content_delta", text: "free" };
    yield { type: "done", finishReason: "stop" };
  });
  assert.equal((await stream.next()).value?.type, "content_delta");
  active = false;
  await assert.rejects(flow.complete(body, { ...opts, requestId: "overlap" }, async () => response), /Another AI job/);
  assert.equal((await stream.next()).value?.type, "done");
  await stream.return(undefined);
  assert.equal((await credits.balance("u")).remainingPoints, 200);
  // Stopping the campaign does not retrofit a debit into the running stream;
  // the next request after close uses the normal metered callback.
  await flow.complete(body, { ...opts, requestId: "next" }, async options => {
    assert.equal(typeof options.onUsageFinalized, "function");
    return response;
  });
  active = true;
  const interrupted = flow.stream(body, opts, async function* () { yield { type: "content_delta", text: "partial" }; });
  await interrupted.next();
  await interrupted.return(undefined);
  await flow.complete(body, { ...opts, requestId: "after-cancel" }, async () => response);
});

test("real encrypted HTTP: admin policy changes catalog and both explicit/legacy Auto settlement", async () => {
  const fixture = await startCreditsHttpRuntime();
  const headers = { authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel", "Content-Type": "application/json" };
  const policy = async (enabled: boolean) => fixture.runtime.services.aiNovelModelSelectionConfigService.updateConfig({ ...config, autoFree: { enabled } });
  const balance = async () => (await fetch(fixture.url + "/api/v1/ai_novel/credits", { headers }).then(r => r.json())).data.remainingMicros;
  const send = async (selection?: unknown) => {
    const result = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", { headers, method: "POST", body: JSON.stringify(encryptCreditsFixture({
      sceneKey: "write_turn", agentProtocol: "pi-v1", stream: true, messages: [{ role: "user", content: "hello" }],
      ...(selection === undefined ? {} : { modelSelection: selection }),
    })) });
    const events = (await result.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => decodeCreditsFixture(JSON.parse(line.slice(6))));
    assert.equal(result.status, 200);
    assert.ok(events.some(event => (event.data ?? event).type === "done"));
  };
  try {
    const before = await balance();
    await policy(true);
    const catalog = await fetch(fixture.url + "/api/v1/ai_novel/models", { headers });
    assert.equal(catalog.headers.get("cache-control"), "no-store");
    assert.equal((await catalog.json()).data.autoFree.active, true);
    await send(); await send({ mode: "auto" });
    assert.equal(await balance(), before);
    await send({ mode: "manual", modelKey: "manual-fixture" });
    const afterManual = await balance();
    assert.ok(afterManual < before);
    await policy(false);
    assert.equal((await fetch(fixture.url + "/api/v1/ai_novel/models", { headers }).then(r => r.json())).data.autoFree.active, false);
    await send();
    assert.ok(await balance() < afterManual);
  } finally { await fixture.close(); }
});
