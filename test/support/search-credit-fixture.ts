import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { InMemoryAiNovelCreditsStore } from "../../src/testing/in-memory-ai-novel-credits-store.ts";
import { AiNovelCreditsService } from "../../src/modules/ai-novel/credits/ai-novel-credits.service.ts";
import { defaultSearchConfig } from "../../src/modules/ai-novel/search/search-config.ts";
import { SearchUsage } from "../../src/modules/ai-novel/search/search-usage.ts";
import { WebSearchService } from "../../src/modules/ai-novel/search/web-search.service.ts";
import { DeepSeekSearchClient } from "../../src/modules/ai-novel/search/deepseek-search-client.ts";
import { parseSearchInput } from "../../src/modules/ai-novel/search/search-types.ts";

export const searchInput = parseSearchInput({ sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "search-1", query: "雨季书店防潮" });
export const searchContext = { userId: "u", requestId: "search-request-1", accountRegion: "CN" as const, appVersion: "1.8.0" };
export const searchRow = { title: "资料", url: "https://example.com/source", snippet: "摘要" };
export async function searchCreditFixture() {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new InMemoryAiNovelCreditsStore();
  const credits = new AiNovelCreditsService(store, async () => "free");
  const config = { ...defaultSearchConfig, enabled: true };
  const usage = new SearchUsage(kv);
  let upstreamCalls = 0;
  const upstream = { fetch: async (_url: unknown, _init?: RequestInit) => Response.json({ results: [searchRow] }) };
  const moderation = { decide: async (_command: { taskType?: string }) => ({ allowed: true, layer: "llm" }) };
  const service = new WebSearchService({ resolve: async () => ({ config: { ...config }, key: "fixture-only" }) } as any,
    usage, credits, { assertUserInputAllowed: command => moderation.decide(command) as any }, async () => true,
    new DeepSeekSearchClient(async (url, init) => { upstreamCalls++; return upstream.fetch(url, init); }));
  const balance = async () => (await credits.balance("u")).remainingPoints;
  const setBalance = async (periodic: number, gift = 0) => {
    await balance();
    await store.transact("u", "", state => {
      state.account!.periodicMicros = String(Math.round(periodic * 1e6));
      state.account!.spentMicros = String(Math.round((200 - periodic) * 1e6));
      state.account!.giftMicros = String(Math.round(gift * 1e6));
    });
  };
  const events = async () => (await store.readUsageReport({ from: "2000-01-01", to: "2100-01-01" })).events;
  return { service, credits, store, config, usage, upstream, moderation, balance, setBalance, events, calls: () => upstreamCalls };
}
