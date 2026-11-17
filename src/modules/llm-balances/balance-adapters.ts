import type { BalanceMetric, BalanceSample } from "./balance-models.ts";

type Json = Record<string, any>;
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function metric(kind: string, scope: BalanceMetric["scope"], remaining: number, unit: BalanceMetric["unit"]): BalanceMetric {
  if (!number(remaining)) throw new Error("Invalid balance payload");
  return { kind, scope, remaining, unit };
}
export function parseOpenRouterCredits(body: Json): BalanceSample {
  if (!number(body.data?.total_credits) || !number(body.data?.total_usage)) throw new Error("Invalid credits payload");
  return { status: "ok", metrics: [metric("account_balance", "account", body.data.total_credits - body.data.total_usage, "USD")] };
}
export function parseBaiBalance(body: Json): BalanceSample {
  if (body.success !== true || !body.data) throw new Error("Balance lookup failed");
  const data = body.data;
  const metrics: BalanceMetric[] = [];
  if (data.api_key_type === "personal") metrics.push(metric("personal_balance", "personal", data.personal_balance, "Credits"));
  else if (data.api_key_type === "team" && data.team) {
    const team = data.team;
    if (team.team_role === "admin" && team.team_balance !== undefined) metrics.push(metric("team_balance", "team", team.team_balance, "Credits"));
    if (team.quota_limit_type === "unlimited") metrics.push({ kind: "member_quota", scope: "member", remaining: null, unit: "Credits", unlimited: true });
    else if (team.quota_limit_type === "limited" && number(team.member_quota_limit) && number(team.member_quota_used)) {
      metrics.push(metric("member_quota", "member", team.member_quota_limit - team.member_quota_used, "Credits"));
    } else throw new Error("Missing member quota fields");
  } else throw new Error("Unknown BAI key scope");
  return { status: "ok", metrics };
}

export async function queryProviderBalance(type: string, credential: string | undefined, fetcher: typeof fetch = fetch): Promise<BalanceSample> {
  if (type !== "openrouter" && type !== "bai") return { status: "unsupported", metrics: [], detail: "No verified balance adapter for this provider or plan. Cloud account cash is not plan quota." };
  if (!credential) return { status: "unconfigured", metrics: [], detail: type === "openrouter" ? "Configure this account’s OpenRouter Management Key." : "Provider API key is not configured." };
  try {
    const response = await fetcher(type === "openrouter" ? "https://openrouter.ai/api/v1/credits" : "https://api.b.ai/v1/balance", {
      headers: { Authorization: `Bearer ${credential}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) return { status: "unauthorized", metrics: [], detail: "Balance credential is invalid or lacks permission." };
    if (!response.ok) return { status: "error", metrics: [], detail: `Balance endpoint returned HTTP ${response.status}.` };
    const body = await response.json();
    return type === "openrouter" ? parseOpenRouterCredits(body) : parseBaiBalance(body);
  } catch {
    return { status: "error", metrics: [], detail: "Balance query failed or returned an invalid payload." };
  }
}
