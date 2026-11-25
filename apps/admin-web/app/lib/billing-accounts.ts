import { adminPath, requestJson } from "./admin-api-client.ts";
export const types = { openrouter: "OpenRouter", bai: "B.AI", aliyun: "阿里云", tencent: "腾讯云", volcengine: "火山引擎", "token-plan": "阿里 Token Plan", "agent-plan": "火山 Agent Plan", geyan: "个验" };
export type AccountType = keyof typeof types;
export const manualTypes: AccountType[] = ["token-plan", "agent-plan", "geyan"];
export interface Account { id: string; name: string; type: AccountType; providers: string[]; alerts: boolean; warning: number; critical: number; mode: "manual" | "automatic"; credentialConfigured: boolean; credentialSource?: "llm" | "account"; loginConfigured?: boolean;
 sample?: { status: string; metrics: BillingBalanceMetric[]; lastSuccessAt?: string; stale: boolean }; alert: { level: string }; }
export interface BillingBalanceMetric { kind?: string; remaining: number | null; unit: string; resetAt?: string }
export interface Settings { intervalMinutes: number; warningRepeatHours: number; criticalRepeatHours: number; failureCount: number; recoverySamples: number; rules: never[]; }
export interface BillingProviderOption { key: string; label: string; accountType: AccountType; }
export interface Document { providerOptions?: BillingProviderOption[]; accounts: Account[]; config: Settings; }
const root = adminPath("/billing-accounts");
export const accountsApi = { get: (signal?: AbortSignal) => requestJson<Document>(root, { signal }), save: (body: unknown) => requestJson(root, { method: "POST", body }),
 refresh: (id: string) => requestJson<{ status: string; detail?: string }>(`${root}/${encodeURIComponent(id)}/refresh`, { method: "POST", body: {}, signal: AbortSignal.timeout(45000) }),
 settings: (config: Settings) => requestJson(`${root}/config`, { method: "PUT", body: { config, desc: "Update balance settings" } }) };
export interface LoginView { sessionId: string; image: string; width: number; height: number; expiresAt: string; loginConfigured?: boolean; completed?: boolean; notice?: string; }
export type BrowserInput = { kind: "credentials"; username?: string; password?: string } | { kind: "text"; text: string } | { kind: "key"; key: string } | { kind: "pointer"; points: { x: number; y: number }[] } | { kind: "scroll"; deltaY: number };
export const manualQueryApi = {
  start: (accountId: string) => requestJson<LoginView>(`${root}/${accountId}/login/start`, { method: "POST", body: {}, signal: AbortSignal.timeout(90000) }),
  action: <T>(accountId: string, sessionId: string, operation: "view" | "input" | "read" | "close", body: unknown = {}) => requestJson<T>(`${root}/${accountId}/login/${sessionId}/${operation}`, { method: "POST", body, signal: AbortSignal.timeout(operation === "input" ? 120000 : 25000) }),
  clear: (accountId: string) => requestJson(`${root}/${accountId}/login/clear`, { method: "POST", body: {} }),
};
