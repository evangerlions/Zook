import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { strictObject } from "../../shared/strict-object.ts";
import { defaultBalanceConfig, type BalanceConfig } from "./balance-models.ts";

export const BALANCE_CONFIG_KEY = "common.llm_balances";
export function validateBalanceConfig(input: unknown): BalanceConfig {
  const config = strictObject(input, ["intervalMinutes", "warningRepeatHours", "criticalRepeatHours", "failureCount", "recoverySamples", "rules"]);
  const limits: Record<string, [number, number]> = { intervalMinutes: [1, 1440], warningRepeatHours: [1, 720],
    criticalRepeatHours: [1, 720], failureCount: [1, 100], recoverySamples: [1, 100] };
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isInteger(config[key]) || (config[key] as number) < min || (config[key] as number) > max) invalid();
  }
  if (!Array.isArray(config.rules) || config.rules.length > 100) invalid();
  const providers = new Set<string>();
  const accounts = new Map<string, string>();
  for (const value of config.rules) {
    const rule = strictObject(value, ["provider", "accountId", "managementPasswordKey", "alerts", "warning", "critical"]);
    if (typeof rule.provider !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(rule.provider) || providers.has(rule.provider)) invalid();
    if (typeof rule.accountId !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(rule.accountId)) invalid();
    if (rule.managementPasswordKey !== undefined && (typeof rule.managementPasswordKey !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(rule.managementPasswordKey))) invalid();
    if (typeof rule.alerts !== "boolean" || typeof rule.warning !== "number" || typeof rule.critical !== "number" ||
      !Number.isFinite(rule.warning) || !Number.isFinite(rule.critical) || rule.critical < 0 || rule.warning <= rule.critical) invalid();
    const settings = JSON.stringify([rule.managementPasswordKey, rule.alerts, rule.warning, rule.critical]);
    if (accounts.has(rule.accountId) && accounts.get(rule.accountId) !== settings) invalid();
    providers.add(rule.provider); accounts.set(rule.accountId, settings);
  }
  return config as unknown as BalanceConfig;
}
function invalid(): never { throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid balance configuration; shared accounts must have identical credentials and alert rules."); }

export class BalanceConfigStore {
  constructor(private readonly configs: VersionedAppConfigService) {}
  async get(): Promise<BalanceConfig> {
    const raw = await this.configs.getValue("common", BALANCE_CONFIG_KEY);
    return raw ? validateBalanceConfig(JSON.parse(raw)) : defaultBalanceConfig();
  }
  async document(revision?: number) {
    const record = revision === undefined ? await this.configs.getLatestRevision("common", BALANCE_CONFIG_KEY)
      : await this.configs.getRevision("common", BALANCE_CONFIG_KEY, revision);
    if (revision !== undefined && !record) throw new ApplicationError(404, "REQ_INVALID_QUERY", "Balance config revision was not found.");
    return { config: record ? validateBalanceConfig(JSON.parse(record.content)) : defaultBalanceConfig(),
      revision: record?.revision, updatedAt: record?.createdAt, revisions: await this.configs.listRevisions("common", BALANCE_CONFIG_KEY) };
  }
  async save(input: unknown, desc: string) {
    const config = validateBalanceConfig(input);
    await this.configs.setValue("common", BALANCE_CONFIG_KEY, JSON.stringify(config), desc || "Update LLM balance alerts");
    return this.document();
  }
  async restore(revision: number, desc: string) {
    await this.document(revision);
    await this.configs.restoreValue("common", BALANCE_CONFIG_KEY, revision, desc || `Restore balance config R${revision}`);
    return this.document();
  }
}
