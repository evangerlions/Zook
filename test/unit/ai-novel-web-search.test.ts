import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { SearchUsage } from "../../src/modules/ai-novel/search/search-usage.ts";
import { defaultSearchConfig, parseSearchConfig, SearchConfigService } from "../../src/modules/ai-novel/search/search-config.ts";
import { parseSearchInput, projectSearchResults } from "../../src/modules/ai-novel/search/search-types.ts";
import { DeepSeekSearchClient } from "../../src/modules/ai-novel/search/deepseek-search-client.ts";
import { WebSearchService } from "../../src/modules/ai-novel/search/web-search.service.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import { buildAiNovelStreamRequestPlan } from "../../src/modules/ai-novel/ai-novel-chat-request-plan.ts";
import { resolveAiNovelChatScene } from "../../src/modules/ai-novel/ai-novel-llm-scenes.ts";
import { webSearchTool } from "../../src/modules/ai-novel/tools/web-search-tool.ts";
import { TOOL_GUIDANCE_PLACEHOLDER, renderSystemPromptSections, validateSystemPromptSection } from "../../src/modules/ai-novel/prompts/system-prompt-section.ts";

const body = { sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "search-call", query: "雨季海边书店防潮" };
const input = parseSearchInput(body);
const ctx = { userId: "u1", requestId: "req-search", accountRegion: "CN" as const, appVersion: "1.8.0" };
const row = { title: "source", url: "https://example.com/a", snippet: "summary", date: null };
async function fixture(options: { deny?: string; ready?: boolean; layer?: string; config?: object; empty?: boolean } = {}) {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const config = { ...defaultSearchConfig, enabled: true, ...options.config };
  const usage = new SearchUsage(kv);
  let calls = 0;
  const service = new WebSearchService({ resolve: async () => ({ config, key: "fixture-key" }) } as any, usage, new AiNovelCreditsService(new InMemoryAiNovelCreditsStore(), async () => "free"), {
    assertUserInputAllowed: async command => {
      if (command.taskType === options.deny) throw new ApplicationError(400, "AI_INPUT_CONTENT_SENSITIVE", "blocked");
      return { allowed: true, layer: options.layer ?? "llm" } as any;
    },
  }, async () => options.ready ?? true, new DeepSeekSearchClient(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.deepseek.com/v1/tools/search");
    assert.deepEqual(JSON.parse(init!.body as string), { query: body.query, count: 5, need_content: false });
    return Response.json({ results: options.empty ? [] : [row] });
  }));
  return { service, usage, calls: () => calls };
}

test("search validates Unicode and independent scene/protocol boundaries", () => {
  assert.equal(parseSearchInput({ ...body, query: "😀".repeat(128) }).query.length, 256);
  for (const patch of [{ query: " " }, { query: "😀".repeat(129) }, { limit: 1.5 }, { limit: 6 }, { agentProtocol: "old" }, { sceneKey: "chapter_summary" }]) assert.throws(() => parseSearchInput({ ...body, ...patch }));
  for (const originalQuestion of [" ", "😀".repeat(129), 2, null]) assert.throws(() => parseSearchInput({ ...body, originalQuestion }));
  assert.equal(parseSearchInput({ ...body, originalQuestion: "😀".repeat(128) }).originalQuestion, "😀".repeat(128));
  assert.throws(() => parseSearchConfig({ ...defaultSearchConfig, secretRef: "plain-secret" }));
  assert.throws(() => parseSearchConfig({ ...defaultSearchConfig, totalTimeoutMs: 100 }));
});
test("original question reaches DeepSeek only after moderation, and is recorded", async () => {
  const f = await fixture();
  const sent: unknown[] = [];
  let moderated = "";
  (f.service as any).safety = { assertUserInputAllowed: async ({ text }: { text: string }) => { moderated = text; return { allowed: true, layer: "llm" }; } };
  (f.service as any).client = new DeepSeekSearchClient(async (_url, init) => {
    sent.push(JSON.parse(init!.body as string));
    return Response.json({ results: [] });
  });
  const request = parseSearchInput({ ...body, originalQuestion: "花店停电后怎么保鲜？" });
  const result = await f.service.execute(request, ctx);
  assert.equal(result.status, "completed");
  assert.match(moderated, /花店停电后怎么保鲜/);
  assert.deepEqual(sent, [{ query: body.query, count: 5, need_content: false, ori_question: "花店停电后怎么保鲜？" }]);
  assert.equal((await f.usage.records())[0].input?.originalQuestion, request.originalQuestion);
});
test("a blocked original question never reaches DeepSeek", async () => {
  const f = await fixture();
  (f.service as any).safety = { assertUserInputAllowed: async ({text}: {text: string}) => { if (text.includes("blocked original")) throw new ApplicationError(400, "AI_INPUT_CONTENT_SENSITIVE", "blocked"); return {allowed:true, layer:"llm"}; } };
  assert.equal((await f.service.execute(parseSearchInput({ ...body, originalQuestion: "blocked original" }), ctx)).status, "blocked");
  assert.equal(f.calls(), 0);
});
test("projection bounds, deduplicates and rejects non-http URLs", () => {
  const projected = projectSearchResults({ results: [{ ...row, title: "😀".repeat(230), summary: "a".repeat(900), content: "PRIVATE FULL PAGE" }, { ...row, url: `${row.url}#fragment` }, { ...row, url: "javascript:alert(1)" }] }, 5);
  assert.equal(projected.length, 1); assert.equal([...projected[0].title].length, 200); assert.equal(projected[0].snippet.length, 800);
  assert.equal(JSON.stringify(projected).includes("PRIVATE FULL PAGE"), false);
  assert.throws(() => projectSearchResults({}, 5));
});
test("successful search records the input and returned results", async () => {
  const f = await fixture(); const result = await f.service.execute(input, ctx);
  assert.equal(result.status, "completed"); assert.equal(f.calls(), 1);
  const records = await f.usage.records(); assert.equal(records.length, 1);
  assert.deepEqual(records[0].input, input);
  assert.deepEqual(records[0].output, result);
});
test("search records retain the latest 100 without a time expiration", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const usage = new SearchUsage(kv, () => Date.now() + 30 * 86400000);
  const base = { userId: "u", sceneKey: "write_turn", toolCallId: "t", timestamp: "2020-01-01T00:00:00Z", status: "completed", returnedCount: 0, filteredCount: 0, latencyMs: 1, provider: "deepseek" as const, upstreamCalls: 1, input, output: { status: "completed" as const, results: [] } };
  for (let i = 0; i < 105; i++) await usage.record({ ...base, requestId: String(i) });
  const records = await usage.records();
  assert.equal(records.length, 100);
  assert.equal(records[0].requestId, "104");
  assert.equal(records[99].requestId, "5");
  assert.deepEqual(records[0].output, { status: "completed", results: [] });
});
test("zero, query block, all-result block and unavailable moderation are distinct", async () => {
  for (const [options, expected, calls] of [
    [{ empty: true }, "completed", 1], [{ deny: "web_search_query" }, "blocked", 0], [{ deny: "web_search_result" }, "blocked", 1],
    [{ ready: false }, "unavailable", 0], [{ layer: "disabled" }, "unavailable", 0], [{ layer: "failed_open" }, "unavailable", 0],
  ] as const) {
    const f = await fixture(options);
    const outcome = await f.service.execute(input, ctx);
    assert.equal(outcome.status, expected); assert.equal(f.calls(), calls);
    const [record] = await f.usage.records();
    assert.deepEqual(record.input, input);
    assert.deepEqual(record.output, outcome);
  }
});
test("direct endpoint execution rejects old/unversioned clients before search", async () => {
  const f = await fixture();
  for (const appVersion of [undefined, "1.7.9", "bad"]) await assert.rejects(f.service.execute(input, { ...ctx, appVersion }), /unavailable/);
  assert.equal(f.calls(), 0);
});
test("KV admission is atomic and isolates users; release does not refund daily spend", async () => {
  const f = await fixture(); const c = { ...defaultSearchConfig, concurrentLimit: 2, dailyLimit: 3 };
  const results = await Promise.all(Array.from({ length: 10 }, () => f.usage.acquire("u1", c)));
  const admitted = results.filter(x => typeof x !== "string"); assert.equal(admitted.length, 2);
  await Promise.all(admitted.map(x => typeof x === "string" ? undefined : x.release()));
  const next = await f.usage.acquire("u1", c); assert.notEqual(typeof next, "string");
  assert.equal(await f.usage.acquire("u1", c), "BUDGET_EXCEEDED"); assert.notEqual(typeof await f.usage.acquire("u2", c), "string");
});
test("tool schema is exposed only with capability, scene and version intersection", () => {
  const scene = resolveAiNovelChatScene("write_turn");
  for (const appVersion of ["1.7.9", "1.8.0"]) {
    const plan = buildAiNovelStreamRequestPlan({ scene, messages: [{ role: "user", content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1", appVersion, webSearchEnabled: true });
    const tools = plan.providerOptions?.tools as any[];
    const search = tools?.find(x => x.function.name === "web_search");
    assert.equal(!!search, appVersion === "1.8.0"); if (search) assert.ok(search.function.parameters.properties.query);
  }
});
test("search appends cost guidance to the existing system message and exposes its tool description", () => {
  const request = { scene: resolveAiNovelChatScene("write_turn"), messages: [{ role: "user" as const, content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1" as const, appVersion: "1.8.0" };
  const withoutSearch = buildAiNovelStreamRequestPlan({ ...request, webSearchEnabled: false });
  const withSearch = buildAiNovelStreamRequestPlan({ ...request, webSearchEnabled: true });
  assert.equal(withSearch.messages.length, withoutSearch.messages.length);
  assert.equal(withSearch.messages.filter(message => message.role === "system").length, withoutSearch.messages.filter(message => message.role === "system").length);
  assert.match(withSearch.messages.find(message => message.role === "system")!.content!, /Web search incurs a cost/);
  assert.doesNotMatch(withoutSearch.messages.find(message => message.role === "system")!.content!, /Web search incurs a cost/);
  const tools = withSearch.providerOptions?.tools as Array<{ function: { name: string; description: string } }>;
  assert.equal(tools.find(tool => tool.function.name === "web_search")?.function.description, webSearchTool.description);
});
test("search cost guidance follows tool version, protocol, and availability", () => {
  const base = { scene: resolveAiNovelChatScene("write_turn"), messages: [{ role: "user" as const, content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1" as const, appVersion: "1.8.0", webSearchEnabled: true };
  for (const patch of [{ appVersion: "1.7.9" }, { appVersion: undefined }, { appVersion: "invalid" }, { agentProtocol: undefined }, { context: { suppliedTools: [] } }, { webSearchEnabled: false }, { scene: resolveAiNovelChatScene("import_book_agent") }]) {
    const plan = buildAiNovelStreamRequestPlan({ ...base, ...patch });
    assert.ok(!plan.messages.some(message => message.content?.includes("Web search incurs a cost")));
  }
});
test("versioned system sections reject invalid version ranges", () => {
  for (const visibility of [{ minAppVersion: "" }, { maxAppVersion: "bad" }, { minAppVersion: "2.0.0", maxAppVersion: "1.9.0" }]) {
    assert.throws(() => validateSystemPromptSection({ content: "rule", placeholder: TOOL_GUIDANCE_PLACEHOLDER, position: 1, scope: { scenes: ["write_turn"], ...visibility } }));
  }
});
test("prompt placeholder renders applicable sections in position order without leaking markers", () => {
  const template = `before\n${TOOL_GUIDANCE_PLACEHOLDER}\nafter`;
  const scope = { scenes: ["write_turn"], minAppVersion: "1.8.0", maxAppVersion: "1.9.0" };
  const sections = [{ content: "second", position: 20, placeholder: TOOL_GUIDANCE_PLACEHOLDER, scope }, { content: "first", position: 10, placeholder: TOOL_GUIDANCE_PLACEHOLDER, scope }];
  const context = { sceneKey: "write_turn", appVersion: "1.8.0", availableTools: [] };
  assert.equal(renderSystemPromptSections(template, sections, context), "before\nfirst\nsecond\nafter");
  assert.equal(renderSystemPromptSections(template, sections, { ...context, appVersion: "2.0.0" }), "before\nafter");
  assert.throws(() => renderSystemPromptSections("no placeholder", sections, context), /Missing system prompt placeholder/);
});
test("kickoff keeps one system message with search guidance and region policy", () => {
  const plan = buildAiNovelStreamRequestPlan({ scene: resolveAiNovelChatScene("kickoff_turn"), messages: [{ role: "user", content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1", appVersion: "1.8.0+123", webSearchEnabled: true, accountRegion: "CN" });
  const system = plan.messages.filter(message => message.role === "system");
  assert.equal(system.length, 1);
  assert.match(system[0]!.content!, /Web search incurs a cost/);
  assert.match(system[0]!.content!, /CN assistant identity policy/);
});
test("all search scenes render tool guidance in place and remove the placeholder when disabled", () => {
  for (const sceneKey of ["kickoff_turn", "kickoff_turn_imported_book", "write_turn", "chapter_draft", "history_chapter_qa"]) {
    const input = { scene: resolveAiNovelChatScene(sceneKey), messages: [{ role: "user" as const, content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1" as const, appVersion: "1.8.0" };
    const enabled = buildAiNovelStreamRequestPlan({ ...input, webSearchEnabled: true });
    const disabled = buildAiNovelStreamRequestPlan({ ...input, webSearchEnabled: false });
    const enabledSystem = enabled.messages.find(message => message.role === "system")!.content!;
    const disabledSystem = disabled.messages.find(message => message.role === "system")!.content!;
    assert.match(enabledSystem, /Web search incurs a cost/, sceneKey);
    assert.ok(!enabledSystem.includes(TOOL_GUIDANCE_PLACEHOLDER), sceneKey);
    assert.ok(!disabledSystem.includes(TOOL_GUIDANCE_PLACEHOLDER), sceneKey);
    assert.equal(enabledSystem.replace("- Web search incurs a cost. Use web_search only when external information is necessary to fulfill the user's request.\n", ""), disabledSystem, sceneKey);
  }
});
test("old and unversioned clients receive no search guidance or placeholder in any search scene", () => {
  for (const sceneKey of ["kickoff_turn", "kickoff_turn_imported_book", "write_turn", "chapter_draft", "history_chapter_qa"]) {
    for (const appVersion of ["1.7.9", undefined, "invalid"]) {
      const input = { scene: resolveAiNovelChatScene(sceneKey), messages: [{ role: "user" as const, content: "test" }], context: { suppliedTools: ["web_search"] }, agentProtocol: "pi-v1" as const, appVersion };
      const enabled = buildAiNovelStreamRequestPlan({ ...input, webSearchEnabled: true });
      const disabled = buildAiNovelStreamRequestPlan({ ...input, webSearchEnabled: false });
      assert.deepEqual(enabled.messages, disabled.messages, `${sceneKey}: ${appVersion}`);
      const system = enabled.messages.find(message => message.role === "system")!.content!;
      assert.ok(!system.includes(TOOL_GUIDANCE_PLACEHOLDER), `${sceneKey}: ${appVersion}`);
      assert.ok(!system.includes("Web search incurs a cost"), `${sceneKey}: ${appVersion}`);
      const tools = enabled.providerOptions?.tools as Array<{ function: { name: string } }> | undefined;
      assert.ok(!tools?.some(tool => tool.function.name === "web_search"), `${sceneKey}: ${appVersion}`);
    }
  }
});
test("deadline bounds hanging KV admission and propagates external stop", async () => {
  const f = await fixture({ config: { totalTimeoutMs: 20 } });
  f.usage.acquire = async () => new Promise(() => {});
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("stop-search")), 5);
  await assert.rejects(f.service.execute(input, { ...ctx, signal: controller.signal }), /stop-search/);
  assert.equal(f.calls(), 0);
});

test("historical search config never falls back to current config when a revision is missing", async () => {
  let currentReads = 0;
  const historical = { ...defaultSearchConfig, dailyLimit: 7 };
  const config = new SearchConfigService({
    getRevision: async (_app: string, _key: string, revision: number) => revision === 2 ? { content: JSON.stringify(historical) } : undefined,
    getValue: async () => { currentReads++; return JSON.stringify(defaultSearchConfig); },
    listRevisions: async () => [{ revision: 2 }],
  } as any, {} as any);
  for (const revision of [0, 999]) {
    await assert.rejects(config.document(revision), (error: unknown) => error instanceof ApplicationError && error.code === "WEB_SEARCH_REVISION_MISSING");
  }
  assert.equal(currentReads, 0, "missing historical revision must not read the latest config");
  assert.equal((await config.document(2)).config.dailyLimit, 7);
  assert.equal((await config.document()).config.dailyLimit, defaultSearchConfig.dailyLimit);
  assert.equal(currentReads, 1);
});

test("search config read failure returns an unavailable outcome before any paid call", async () => {
  const f = await fixture();
  f.service.config.resolve = async () => { throw new Error("config storage unavailable"); };
  assert.deepEqual(await f.service.execute(input, ctx), { status: "unavailable", code: "UPSTREAM_UNAVAILABLE" });
  assert.equal(f.calls(), 0);
  assert.equal((await f.usage.records())[0].output?.status, "unavailable");
});

test("Stop during config setup propagates cancellation rather than reporting search unavailable", async () => {
  const f = await fixture();
  f.service.config.resolve = async () => new Promise(() => {});
  const controller = new AbortController();
  const pending = f.service.execute(input, { ...ctx, signal: controller.signal });
  controller.abort(new Error("stop-during-search-setup"));
  await assert.rejects(pending, /stop-during-search-setup/);
  assert.equal(f.calls(), 0);
});

test("hanging config setup times out as an explicit unavailable outcome", async () => {
  const f = await fixture();
  f.service.config.resolve = async () => new Promise(() => {});
  // AbortSignal.timeout does not keep Node alive; retain a bounded test handle.
  const keepAlive = setTimeout(() => {}, 4000);
  try {
    assert.deepEqual(await f.service.execute(input, ctx), { status: "unavailable", code: "UPSTREAM_UNAVAILABLE" });
    assert.equal(f.calls(), 0);
  } finally { clearTimeout(keepAlive); }
});


test("optional search availability does not break creative chat on config failure", async () => {
  const f = await fixture();
  f.service.config.resolve = async () => { throw new Error("config unavailable"); };
  assert.equal(await f.service.available("CN"), false);
});

test("Stop does not report a false operational record failure", async () => {
  const f = await fixture();
  const warnings: string[] = [];
  (f.service as any).logger = { info: () => {}, warn: (message: string) => warnings.push(message) };
  f.usage.acquire = async () => new Promise(() => {});
  f.usage.record = async () => new Promise(() => {});
  const stop = new AbortController();
  setTimeout(() => stop.abort(new Error("stop")), 5);
  await assert.rejects(f.service.execute(input, {...ctx, signal: stop.signal}), /stop/);
  assert.deepEqual(warnings, []);
});
test("an actual operational record failure still emits a diagnostic warning", async () => {
  const f = await fixture();
  const warnings: string[] = [];
  (f.service as any).logger = { info: () => {}, warn: (message: string) => warnings.push(message) };
  f.usage.record = async () => { throw new Error("storage failure"); };
  assert.equal((await f.service.execute(input, ctx)).status, "completed");
  assert.deepEqual(warnings, ["web_search usage record failed"]);
});
