import type { JobQueue } from "../../infrastructure/queue/job-queue.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type { AppConfigRecord, HttpRequest } from "../../shared/types.ts";

export type LightTickRuntimeScope = "core" | "full";
export const SCOPE_UNAVAILABLE = "LIGHTTICK_CAPABILITY_UNAVAILABLE";

export function runtimeScope(raw: unknown): LightTickRuntimeScope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "core";
  const settings = (raw as Record<string, any>).settings;
  return settings && typeof settings === "object" && !Array.isArray(settings) && settings.runtimeScope === "full" ? "full" : "core";
}

export function validateRuntimeScope(appId: string, raw: string) {
  if (appId !== "lighttick") return;
  const settings = JSON.parse(raw)?.settings;
  if (settings?.runtimeScope !== undefined && !["core", "full"].includes(settings.runtimeScope))
    throw new ApplicationError(422, "REQ_FIELD_INVALID", "settings.runtimeScope must be core or full.");
}

// Read and recovery are intentionally independent of new optional commands.
export function restrictedRequest(r: Pick<HttpRequest, "path" | "method">): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(r.method)) return false;
  const p = r.path.replace(/^\/api\/v1\/lighttick\//, "");
  if (r.method === "POST" && /^(investments\/(work|market\/work|research-ai|screening\/runs|observations\/work|backtests|accounts\/[^/]+\/portfolio\/work)|learning\/work|ai\/model-settings\/tests|account\/github\/tests)\/[^/]+\/cancel$/.test(p)) return false;
  if (r.method === "POST" && /^investments\/observations\/monitors\/[^/]+\/stop$/.test(p)) return false;
  if (r.method === "DELETE" && ["ai/model-settings", "account/github"].includes(p)) return false;
  return /^(investments|form-records|planning-sessions|ai\/model-settings|account\/github)(\/|$)/.test(p)
    || /^(learning\/(work|routes|collections)(\/|$)|learning\/lessons\/[^/]+\/publications$)/.test(p)
    || /^(onboarding|plan-runs|coach-runs|review-runs|change-proposal-runs)$/.test(p)
    || p === "action-plans/reviews/generate";
}

export class LightTickScopePolicy {
  constructor(readonly record: () => Promise<AppConfigRecord | undefined> = async () => undefined) {}
  async current(): Promise<LightTickRuntimeScope> {
    try {
      const record = await this.record();
      return record ? runtimeScope(JSON.parse(record.configValue)) : "core";
    } catch { return "core"; }
  }
  async assertFull() {
    if (await this.current() !== "full") throw new ApplicationError(503, SCOPE_UNAVAILABLE,
      "This capability is outside the current version. History, cancellation and receipt lookup remain available; retain the original request and local draft.");
  }
  async assertRequest(r: Pick<HttpRequest, "path" | "method">) {
    if (restrictedRequest(r)) await this.assertFull();
  }
}

export function coreJob(name: string) {
  return ["lighttick.notification.send", "lighttick.notification.schedule", "lighttick.execution.aggregate"].includes(name);
}

export function scopeQueue(queue: JobQueue, assertFull: () => Promise<void>): JobQueue {
  return {
    async add(name, payload, options) {
      if (name.startsWith("lighttick.") && !coreJob(name)) await assertFull();
      return queue.add(name, payload, options);
    },
    processDueJobs: (handler, now) => queue.processDueJobs(handler, now),
  };
}
