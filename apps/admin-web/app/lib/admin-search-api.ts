import { adminPath, requestJson } from "./admin-api-client";

export interface SearchConfig { enabled: boolean; regions: string[]; secretRef: string; dailyLimit: number; concurrentLimit: number; maxResults: number; pointsPerSearch: number; upstreamTimeoutMs: number; totalTimeoutMs: number }
export interface SearchConfigDocument { config: SearchConfig; revisions: { revision: number; createdAt: string; desc: string }[] }
export interface SearchRecord { requestId: string; userId: string; sceneKey: string; timestamp: string; status: string; code?: string; returnedCount: number; filteredCount: number; latencyMs: number; upstreamCalls: number; chargedPoints?: number; billingEnvironment?: "production" | "sandbox"; billingStatus?: "not_charged" | "charged" | "replayed" | "admin_test"; input?: { query: string; limit: number; sceneKey: string; agentProtocol: string; toolCallId: string }; output?: { status: string; code?: string; results?: { sourceId: string; title: string; url: string; snippet: string; publishedAt: string | null }[] } }
const base = adminPath("/apps/ai_novel/web-search");
export const searchApi = {
  config: () => requestJson<SearchConfigDocument>(base),
  save: (config: SearchConfig, desc: string) => requestJson<SearchConfigDocument>(base, { method: "PUT", body: { config, desc } }),
  restore: (revision: number) => requestJson<SearchConfigDocument>(`${base}/revisions/${revision}/restore`, { method: "POST", body: { desc: `Restore search revision ${revision}` } }),
  records: () => requestJson<{ items: SearchRecord[] }>(`${base}/records`),
  test: (query: string, region: string) => requestJson<{ status: string; code?: string; resultCount?: number }>(`${base}/test`, { method: "POST", body: { query, region } }),
};
