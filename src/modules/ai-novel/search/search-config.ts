import type { VersionedAppConfigService } from "../../../services/versioned-app-config.service.ts";
import { isSecretReference, type SecretReferenceResolver } from "../../../services/secret-reference-resolver.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { AccountRegion } from "../../../shared/types.ts";

export const SEARCH_CONFIG_KEY = "ai_novel.web_search";
export interface SearchConfig {
  enabled: boolean; regions: ("CN" | "GLOBAL")[]; secretRef: string;
  dailyLimit: number; concurrentLimit: number; maxResults: number;
  upstreamTimeoutMs: number; totalTimeoutMs: number;
}
export const defaultSearchConfig: SearchConfig = { enabled: false, regions: ["CN"], secretRef: "{{zook.ps.deepseek.web_search_api_key}}", dailyLimit: 20, concurrentLimit: 2, maxResults: 5, upstreamTimeoutMs: 10_000, totalTimeoutMs: 20_000 };

export function parseSearchConfig(input: unknown): SearchConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) badRequest("WEB_SEARCH_CONFIG_INVALID", "Search config must be an object.");
  const c = input as Record<string, unknown>;
  if (typeof c.enabled !== "boolean" || !Array.isArray(c.regions) || c.regions.some(x => x !== "CN" && x !== "GLOBAL") || typeof c.secretRef !== "string" || !isSecretReference(c.secretRef)) badRequest("WEB_SEARCH_CONFIG_INVALID", "Invalid search enablement, regions or password reference.");
  const ranges = { dailyLimit: [1, 10000], concurrentLimit: [1, 10], maxResults: [1, 5], upstreamTimeoutMs: [100, 30000], totalTimeoutMs: [100, 60000] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = c[key];
    if (!Number.isInteger(n) || (n as number) < min || (n as number) > max) badRequest("WEB_SEARCH_CONFIG_INVALID", `Invalid ${key}.`);
  }
  if ((c.upstreamTimeoutMs as number) > (c.totalTimeoutMs as number)) badRequest("WEB_SEARCH_CONFIG_INVALID", "Upstream timeout exceeds total timeout.");
  return { enabled: c.enabled, regions: [...new Set(c.regions)] as SearchConfig["regions"], secretRef: c.secretRef.trim(), dailyLimit: c.dailyLimit as number, concurrentLimit: c.concurrentLimit as number, maxResults: c.maxResults as number, upstreamTimeoutMs: c.upstreamTimeoutMs as number, totalTimeoutMs: c.totalTimeoutMs as number };
}

export class SearchConfigService {
  constructor(readonly revisions: VersionedAppConfigService, private readonly secrets: SecretReferenceResolver) {}
  async get(): Promise<SearchConfig> {
    const raw = await this.revisions.getValue("ai_novel", SEARCH_CONFIG_KEY);
    return raw ? parseSearchConfig(JSON.parse(raw)) : { ...defaultSearchConfig, regions: [...defaultSearchConfig.regions] };
  }
  async document(revision?: number) {
    const current = revision !== undefined ? await this.revisions.getRevision("ai_novel", SEARCH_CONFIG_KEY, revision) : undefined;
    if (revision !== undefined && !current) badRequest("WEB_SEARCH_REVISION_MISSING", "Search revision not found.");
    return { configKey: SEARCH_CONFIG_KEY, config: current ? parseSearchConfig(JSON.parse(current.content)) : await this.get(), revisions: await this.revisions.listRevisions("ai_novel", SEARCH_CONFIG_KEY) };
  }
  async save(config: unknown, desc?: string) {
    await this.revisions.setValue("ai_novel", SEARCH_CONFIG_KEY, JSON.stringify(parseSearchConfig(config)), desc);
    return this.document();
  }
  async restore(revision: number, desc?: string) {
    const old = await this.revisions.getRevision("ai_novel", SEARCH_CONFIG_KEY, revision);
    if (!old) badRequest("WEB_SEARCH_REVISION_MISSING", "Search revision not found.");
    parseSearchConfig(JSON.parse(old.content));
    await this.revisions.restoreValue("ai_novel", SEARCH_CONFIG_KEY, revision, desc);
    return this.document();
  }
  async resolve(region: AccountRegion): Promise<{ config: SearchConfig; key: string } | undefined> {
    const config = await this.get();
    if (!config.enabled || !config.regions.includes(region as "CN" | "GLOBAL")) return undefined;
    try { const key = await this.secrets.resolveString(config.secretRef); return key.trim() ? { config, key } : undefined; }
    catch { return undefined; }
  }
}
