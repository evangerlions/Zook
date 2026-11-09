import type { VersionedAppConfigService } from "../../../../services/versioned-app-config.service.ts";
import type { KVManager } from "../../../../infrastructure/kv/kv-manager.ts";
import {
  keys,
  object,
  integer,
  text,
  digest,
  fail,
} from "../../learning/native-learning.validation.ts";
import type { DailySupplier } from "./market.types.ts";
import { MarketDataError } from "./market.validation.ts";
export const MARKET_SECRET_SCOPE = "lighttick-market-provider-secrets";
export const DAILY_SUPPLIERS = [
  "csv",
  "tushare",
  "eastmoney",
  "tencent",
] as const;
export function validateMarketDeliveryConfig(appId: string, raw: string) {
  if (appId !== "lighttick") return;
  const root = JSON.parse(raw);
  if (root.investment_market === undefined) return;
  const branch = object(root.investment_market);
  keys(branch, ["providers"]);
  const providers = object(branch.providers);
  keys(providers, [...DAILY_SUPPLIERS]);
  for (const v of Object.values(providers)) {
    const p = object(v);
    keys(p, ["enabled"]);
    if (typeof p.enabled !== "boolean")
      fail(
        422,
        "Provider enabled must be boolean; credentials belong only in the server secret endpoint.",
      );
  }
}
interface Credential {
  revision: number;
  token: string | null;
  updated_at: string;
  receipts: {
    key: string;
    hash: string;
    result: { revision: number; configured: boolean; updated_at: string };
  }[];
}
export class MarketPolicyService {
  constructor(
    readonly config: VersionedAppConfigService,
    readonly kv: KVManager,
    readonly clock = () => new Date(),
  ) {}
  async policy(supplier: DailySupplier) {
    const raw =
      (await this.config.getValue("lighttick", "admin.delivery_config")) ??
      "{}";
    let setting: any;
    try {
      validateMarketDeliveryConfig("lighttick", raw);
      setting = JSON.parse(raw).investment_market?.providers?.[supplier];
    } catch {
      throw new MarketDataError("POLICY_UNAVAILABLE", 503);
    }
    const secret =
      supplier === "tushare"
        ? await this.kv.getJson<Credential>(MARKET_SECRET_SCOPE, "tushare")
        : undefined;
    return {
      enabled: setting?.enabled ?? supplier === "csv",
      revision: digest([
        setting ?? { enabled: supplier === "csv" },
        supplier,
        secret?.revision ?? 0,
      ]),
      ...(supplier === "tushare"
        ? { tushare_token: secret?.token ?? undefined }
        : {}),
    };
  }
  async capabilities() {
    const rows = [];
    for (const supplier of DAILY_SUPPLIERS) {
      const p = await this.policy(supplier);
      rows.push({
        supplier,
        enabled: p.enabled,
        credential_configured: supplier !== "tushare" || !!p.tushare_token,
        revision: p.revision,
      });
    }
    return { suppliers: rows };
  }
  async summary() {
    const c = await this.kv.getJson<Credential>(MARKET_SECRET_SCOPE, "tushare");
    return {
      revision: c?.revision ?? 0,
      configured: !!c?.token,
      updated_at: c?.updated_at ?? null,
    };
  }
  async rotate(b: Record<string, unknown>, key: string) {
    keys(b, ["base_revision", "token"]);
    const base = integer(b.base_revision, 0, 2147483646);
    if (key.length < 8 || key.length > 128)
      fail(422, "Retain the original admin request identity.");
    const token = b.token === null ? null : text(b.token, 4096, true);
    if (token !== null && (token.length < 8 || /[\x00-\x20]/.test(token)))
      fail(422, "Invalid Tushare credential.");
    const raw = await this.kv.getString(MARKET_SECRET_SCOPE, "tushare"),
      old: Credential | undefined = raw ? JSON.parse(raw) : undefined,
      hash = digest(b),
      keyHash = digest(key),
      prior = old?.receipts.find((r) => r.key === keyHash);
    if (prior) {
      if (prior.hash !== hash)
        fail(409, "Admin request identity belongs to another body.");
      return prior.result;
    }
    if ((old?.revision ?? 0) !== base)
      fail(409, "Credential revision changed; compare before rotating.");
    const now = this.clock().toISOString(),
      result = { revision: base + 1, configured: !!token, updated_at: now },
      next: Credential = {
        revision: base + 1,
        token,
        updated_at: now,
        receipts: [
          ...(old?.receipts ?? []),
          { key: keyHash, hash, result },
        ].slice(-32),
      };
    if (
      !(await this.kv.applyAtomic(MARKET_SECRET_SCOPE, {
        compare: [{ key: "tushare", value: raw ?? null }],
        set: [{ key: "tushare", value: JSON.stringify(next) }],
      }))
    )
      fail(
        409,
        "Credential changed concurrently; retain the original request.",
      );
    return result;
  }
}
