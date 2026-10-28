import { inspectRetentionExperiment } from "./bodylog-retention-experiment.ts";
import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { EventName } from "../../shared/types.ts";
import { ApplicationError } from "../../shared/errors.ts";

export const RETENTION_EVENTS = ["growth_card_opened", "local_goal_completed", "invitation_created", "invitation_opened", "invitation_attributed", "buddy_encouragement_sent", "seven_day_plan_opened", "seven_day_plan_completed", "reward_claimed"] as const;
const PROPERTY_VALUES: Record<string, string[]> = {
  source: ["dashboard", "home", "invitation", "buddy", "plan"],
  state: ["active", "completed", "queued"], action: ["open", "complete", "retry", "claim"],
};
export class BodyLogRetentionTelemetry {
  constructor(private readonly database: ApplicationDatabase) {}
  async assignment(userId: string, occurredAt?: string) {
    const config = await this.database.findAppConfig("bodylog", "bodylog.retention-experiment");
    // A delayed client event predating this revision has no server-proof of
    // assignment to the new experiment. Keep it observable but out of cohorts.
    if (occurredAt && config && Date.parse(occurredAt) < Date.parse(config.updatedAt)) return { experimentId: "disabled", variant: "control" };
    const inspected = inspectRetentionExperiment(config?.configValue);
    const value = inspected.config;
    if (!inspected.valid || !value?.enabled) return { experimentId: "disabled", variant: "control" };
    const bucket = createHash("sha256").update(`${value.id}:${userId}`).digest().readUInt32BE(0) % 100;
    return { experimentId: value.id, variant: bucket < value.treatmentPercent ? "treatment" : "control" };
  }
  async experimentStatus() {
    const stored = await this.database.findAppConfig("bodylog", "bodylog.retention-experiment");
    const result = inspectRetentionExperiment(stored?.configValue);
    return { enabled: result.valid && result.config?.enabled === true, valid: result.valid, errors: result.errors,
      id: result.config?.id ?? null, treatmentPercent: result.config?.treatmentPercent ?? 0,
      design: result.valid ? result.config?.design ?? null : null, requiredPerVariant: result.requiredPerVariant };
  }
  async record(userId: string, input: Record<string, unknown>) {
    const props = input.properties;
    if (input.consent !== true || typeof input.name !== "string" || !(RETENTION_EVENTS as readonly string[]).includes(input.name) ||
      typeof input.eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId) ||
      typeof input.timestamp !== "string" || !Number.isFinite(Date.parse(input.timestamp)) || Date.parse(input.timestamp) > Date.now() + 300_000 || Date.parse(input.timestamp) < Date.now() - 7 * 86_400_000 ||
      !props || typeof props !== "object" || Array.isArray(props) || Object.entries(props).some(([key,value]) => typeof value !== "string" || !PROPERTY_VALUES[key]?.includes(value)))
      throw new ApplicationError(400, "BODYLOG_RETENTION_EVENT_INVALID", "Explicit consent and allowlisted event values are required.");
    const id = "bodylog_event_" + createHash("sha256").update(JSON.stringify([userId, input.eventId])).digest("hex");
    {
      const assignment = await this.assignment(userId, input.timestamp);
      await this.database.insertAnalyticsEvents([{ id, appId: "bodylog", userId, platform: "ios", sessionId: "bodylog-retention", pageKey: String((props as Record<string,string>).source ?? "home"),
        eventName: `bodylog_${input.name}` as EventName, occurredAt: input.timestamp, receivedAt: new Date().toISOString(), metadata: { properties: props, ...assignment } }]);
    }
    return { accepted: true };
  }
  async metrics() {
    const events = await this.database.listAnalyticsEvents("bodylog");
    const actions = events.filter(item => item.eventName === "bodylog_local_goal_completed");
    const exposures = events.filter(item => item.eventName === "bodylog_seven_day_plan_opened" && (item.metadata.properties as Record<string,string>)?.state === "completed" && typeof item.metadata.experimentId === "string" && item.metadata.experimentId !== "disabled" && ["control", "treatment"].includes(String(item.metadata.variant)));
    const experimentIds = [...new Set(exposures.map(item => String(item.metadata.experimentId)))];
    const experiments = experimentIds.map(experimentId => ({ experimentId, variants: ["control", "treatment"].map(variant => {
      const rows = exposures.filter(item => item.metadata.variant === variant && item.metadata.experimentId === experimentId).sort((a,b) => a.occurredAt.localeCompare(b.occurredAt));
      const cohort = new Map<string, string>();
      for (const row of rows) if (!cohort.has(row.userId)) cohort.set(row.userId,row.occurredAt.slice(0,10));
      const actionDates = new Map<string, Set<string>>();
      for (const action of actions.filter(item => item.metadata.experimentId === experimentId && item.metadata.variant === variant)) {
        const dates = actionDates.get(action.userId) ?? new Set<string>(); dates.add(action.occurredAt.slice(0,10)); actionDates.set(action.userId, dates);
      }
      const retention = (day: number) => {
        let eligible = 0, retained = 0;
        for (const [user,first] of cohort) {
          const target = new Date(Date.parse(`${first}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0,10);
          if (Date.parse(`${target}T00:00:00Z`) + 86_400_000 > Date.now()) continue;
          eligible++; if (actionDates.get(user)?.has(target)) retained++;
        }
        return { eligible, retained, rate: eligible ? retained / eligible : null };
      };
      return { variant, exposed: cohort.size, d1: retention(1), d7: retention(7) };
    }) }));
    const funnel = Object.fromEntries(RETENTION_EVENTS.filter(name => name.startsWith("invitation_")).map(name => [name,
      new Set(events.filter(item => item.eventName === `bodylog_${name}`).map(item => item.userId)).size]));
    return { generatedAt: new Date().toISOString(), cohortTimeZone: "UTC", experiments, invitationFunnelUniqueUsers: funnel };
  }
}
