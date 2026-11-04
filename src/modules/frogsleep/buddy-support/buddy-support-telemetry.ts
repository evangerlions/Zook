import type { AnalyticsService } from "../../analytics/analytics.service.ts";
import { appID } from "./buddy-support-validation.ts";

export const supportServerEvents = new Set([
  "frogsleep_support_sent", "frogsleep_support_acknowledged", "frogsleep_support_receive_changed",
]);

/** Explicit operation facts only: never record note bodies, template IDs, partner IDs or local viewing. */
export function supportTelemetry(method: string, path: string, result: Record<string, any>, input: Record<string, unknown>) {
  if (method === "POST" && path === "/notes" && result.note) return {
    eventName: "frogsleep_support_sent" as const, key: result.note.id, at: result.note.created_at,
    metadata: { domain: result.note.domain, kind: result.note.template_key ? (result.note.flower ? "template_flower" : "template") : "flower" },
  };
  if (method === "POST" && path.endsWith("/acknowledgement") && result.note_id) return {
    eventName: "frogsleep_support_acknowledged" as const, key: result.note_id, metadata: {},
  };
  if (method === "PUT" && path.startsWith("/permissions/") && result.permission) return {
    eventName: "frogsleep_support_receive_changed" as const, key: String(input.operation_id),
    at: result.permission.updated_at, metadata: { enabled: result.permission.enabled === true },
  };
}

/** Stable server keys deduplicate retries; telemetry outages never roll back a committed operation. */
export async function recordSupportTelemetry(service: AnalyticsService | undefined, actor: string,
  event: ReturnType<typeof supportTelemetry>) {
  if (!service || !event) return;
  try {
    await service.recordServerEvent({ appId: appID, userId: actor, eventName: event.eventName,
      dedupeKey: `${event.eventName}:${event.key}`, pageKey: "buddy-support", platform: "web",
      occurredAt: event.at ?? new Date().toISOString(), metadata: event.metadata });
  } catch { console.warn("Support telemetry unavailable", { event: event.eventName }); }
}
