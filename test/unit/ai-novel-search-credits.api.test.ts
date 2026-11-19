import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";
import { defaultSearchConfig } from "../../src/modules/ai-novel/search/search-config.ts";
import { DeepSeekSearchClient } from "../../src/modules/ai-novel/search/deepseek-search-client.ts";
import { searchCreditCharge } from "../../src/modules/ai-novel/search/search-credit-charge.ts";
import { parseSearchInput } from "../../src/modules/ai-novel/search/search-types.ts";

const payload = { sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "paid-http-search", query: "书店防潮" };
async function fixture() {
  const f = await startCreditsHttpRuntime();
  const search = f.runtime.services.aiNovelLlmService.webSearch!;
  const credits = f.runtime.services.aiNovelLlmService.creditsFlow.credits;
  await f.runtime.services.commonPasswordConfigService.set("deepseek.web_search_api_key", "fixture", "fixture-only");
  await search.config.save({ ...defaultSearchConfig, enabled: true });
  await f.runtime.services.appRegistryService.finalizeAccountRegion("ai_novel", "user_alice", "CN");
  const selection = f.runtime.services.aiNovelModelSelectionConfigService;
  await selection.updateConfig({ ...(await selection.getCurrentConfig()), autoFree: { enabled: true } });
  (search as any).moderationReady = async () => true;
  (search as any).safety = { assertUserInputAllowed: async () => ({ allowed: true, layer: "llm" }) };
  let calls = 0;
  (search as any).client = new DeepSeekSearchClient(async () => {
    calls++;
    return Response.json({ results: [{ title: "防潮资料", url: "https://example.com/reference", snippet: "场景资料" }] });
  });
  async function post(body: Record<string, unknown> = payload) {
    const response = await fetch(`${f.url}/api/v1/ai_novel/ai/web-search`, { method: "POST", headers: {
      Authorization: `Bearer ${f.token}`, "X-App-Id": "ai_novel", "X-App-Version": "1.8.0", "Content-Type": "application/json",
    }, body: JSON.stringify(encryptCreditsFixture(body)) });
    assert.equal(response.status, 200);
    const encrypted = await response.json();
    assert.equal(encrypted.encrypted, true);
    return decodeCreditsFixture(encrypted).data;
  }
  return { ...f, search, credits, post, calls: () => calls };
}

test("fresh encrypted HTTP search charges under Auto-free, rejects client exemptions and replays without charging", async () => {
  const f = await fixture();
  try {
    const result = await f.post({ ...payload, adminTest: true, billingStatus: "admin_test", pointsPerSearch: 0 });
    assert.equal(result.status, "completed");
    assert.equal((await f.credits.balance("user_alice")).remainingPoints, 198);
    assert.deepEqual(await f.post(), result);
    assert.equal(f.calls(), 1);
    assert.equal((await f.credits.balance("user_alice")).remainingPoints, 198);
    assert.deepEqual(await f.post({ ...payload, query: "changed" }), { status: "unavailable", code: "CALL_CONFLICT" });
    console.log(JSON.stringify({ evidence: "search-credits-http", url: f.url, caller: "fixture user", encrypted: true,
      autoFree: true, supplier: "deterministic fixture", calls: f.calls(), pointsBefore: 200, pointsAfter: 198, replay: "no new debit" }));
  } finally { await f.close(); await f.runtime.close(); }
});

test("encrypted HTTP search denies insufficient credits without supplier calls or reference leakage", async () => {
  const f = await fixture();
  try {
    await f.credits.settleFixedCharge("user_alice", "fixture-drain", searchCreditCharge(parseSearchInput({ ...payload, toolCallId: "drain" }), 199));
    assert.deepEqual(await f.post(), { status: "unavailable", code: "CREDITS_INSUFFICIENT" });
    assert.equal(f.calls(), 0);
    assert.equal((await f.credits.balance("user_alice")).remainingPoints, 1);
  } finally { await f.close(); await f.runtime.close(); }
});
