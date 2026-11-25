import type { BalanceMetric, BalanceSample } from "../llm-balances/balance-models.ts";
import { signVolcOpenApi } from "./volc-openapi-signature.ts";

export const arkQuotaWindows = [
  { field: "AFPFiveHour", kind: "agent_plan_5h_remaining", name: "近5小时用量", label: "5-hour quota" },
  { field: "AFPWeekly", kind: "agent_plan_weekly_remaining", name: "近一周用量", label: "Weekly quota" },
  { field: "AFPMonthly", kind: "agent_plan_monthly_remaining", name: "近一月用量", label: "Monthly quota" },
] as const;

export function parseArkAccessKeys(credential: string): { accessKey: string; secretKey: string } | undefined {
  try {
    const keys = JSON.parse(credential);
    if (typeof keys?.accessKey === "string" && keys.accessKey.trim() && typeof keys.secretKey === "string" && keys.secretKey.trim()) {
      return { accessKey: keys.accessKey.trim(), secretKey: keys.secretKey.trim() };
    }
  } catch { /* Invalid credential JSON. */ }
}

function afp(value: unknown): number {
  if (typeof value === "number") return value >= 0 ? value : NaN;
  return typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
}

export function parseArkQuota(body: unknown): BalanceSample {
  const envelope = body as { ResponseMetadata?: { Error?: { Code?: string } }; Result?: Record<string, { Quota?: unknown; Used?: unknown; ResetTime?: number }> };
  const error = envelope?.ResponseMetadata?.Error;
  if (error) {
    const denied = /Unauthorized|Forbidden|AccessDenied|InvalidAccessKey|Signature/i.test(error.Code ?? "");
    return { status: denied ? "unauthorized" : "error", metrics: [], detail: "Ark rejected the AFP quota query." };
  }

  const metrics: BalanceMetric[] = [];
  for (const { field, kind } of arkQuotaWindows) {
    const window = envelope?.Result?.[field];
    const quota = afp(window?.Quota);
    const used = afp(window?.Used);
    if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(used)) {
      return { status: "error", metrics: [], detail: "Ark did not return all three valid AFP quota windows." };
    }
    const resetTime = window?.ResetTime;
    const resetAt = typeof resetTime === "number" && Number.isSafeInteger(resetTime) && resetTime > 0 && resetTime <= 8.64e15
      ? new Date(resetTime).toISOString() : undefined;
    metrics.push({ kind, scope: "personal", remaining: Math.max(0, (quota - used) / quota) * 100, unit: "%", ...(resetAt ? { resetAt } : {}) });
  }
  return { status: "ok", metrics };
}

export async function queryArkQuota(credential: string | undefined, fetcher: typeof fetch): Promise<BalanceSample> {
  const keys = credential && parseArkAccessKeys(credential);
  if (!keys) return { status: "unconfigured", metrics: [] };
  const [url, options] = signVolcOpenApi({ host: "ark.cn-beijing.volcengineapi.com", region: "cn-beijing", service: "ark",
    query: "Action=GetAFPUsage&Version=2024-01-01", method: "POST" }, keys.accessKey, keys.secretKey);
  try {
    const response = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (response.status === 401 || response.status === 403) return { status: "unauthorized", metrics: [] };
    if (!response.ok) return { status: "error", metrics: [], detail: `Ark quota endpoint returned HTTP ${response.status}.` };
    return parseArkQuota(await response.json());
  } catch {
    return { status: "error", metrics: [], detail: "Ark quota query failed." };
  }
}
