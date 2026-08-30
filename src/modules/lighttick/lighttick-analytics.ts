import type { AnalyticsService } from "../analytics/analytics.service.ts";
import type { Platform } from "../../shared/types.ts";

export const LIGHTTICK_SERVER_EVENTS = new Set([
  "lighttick_guest_created", "lighttick_account_upgraded", "lighttick_session_recovered",
  "lighttick_wish_submitted", "lighttick_starter_shown", "lighttick_starter_started", "lighttick_starter_completed",
  "lighttick_preview_viewed", "lighttick_weekly_commitment", "lighttick_plan_confirmed",
  "lighttick_task_started", "lighttick_task_completed", "lighttick_task_skipped", "lighttick_task_deferred",
  "lighttick_goal_paused", "lighttick_goal_resumed", "lighttick_recovery_started", "lighttick_return_observed",
  "lighttick_review_viewed", "lighttick_proposal_accepted", "lighttick_proposal_rejected", "lighttick_sync_conflict",
  "lighttick_notification_queued", "lighttick_notification_delivered", "lighttick_notification_suppressed", "lighttick_notification_failed",
] as const);
export type LightTickServerEvent = typeof LIGHTTICK_SERVER_EVENTS extends Set<infer T> ? T : never;

const ALLOWED_FIELDS = new Set(["operation_id", "resource_id", "resource_type", "goal_id", "plan_id", "task_id", "review_id",
  "proposal_id", "source", "platform", "result", "reason_code", "variant", "actual_minutes", "estimated_minutes", "mode",
  "period", "status", "valid_action_count", "conflict_code", "provider", "delivery_state", "business_date", "device_count",
  "retry_count", "notification_type", "account_kind"]);
const DENIED_FIELD = /authorization|access.?token|refresh.?token|push.?token|provider.?key|device.?secret|verification|prompt|note|coach|private|wish|text/i;

export class LightTickAnalyticsService {
  constructor(private readonly analytics: AnalyticsService, private readonly clock = () => new Date()) {}
  async record(input: { userId: string; event: LightTickServerEvent; dedupeKey: string; pageKey: string;
    platform?: Platform; metadata?: Record<string, unknown> }) {
    if (!LIGHTTICK_SERVER_EVENTS.has(input.event)) throw new Error("LightTick analytics event is not allowlisted.");
    if (!input.dedupeKey || input.dedupeKey.length > 256) throw new Error("LightTick analytics dedupe key is invalid.");
    await this.analytics.recordServerEvent({ appId: "lighttick", userId: input.userId, eventName: input.event,
      dedupeKey: `${input.event}:${input.dedupeKey}`, pageKey: input.pageKey, platform: input.platform ?? "web",
      occurredAt: this.clock().toISOString(), metadata: sanitizeMetadata(input.metadata ?? {}) });
  }
}

export function sanitizeMetadata(input: Record<string, unknown>) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_FIELDS.has(key) || DENIED_FIELD.test(key)) continue;
    if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) output[key] = value;
    else if (typeof value === "string") output[key] = value.slice(0, 160);
  }
  return output;
}
