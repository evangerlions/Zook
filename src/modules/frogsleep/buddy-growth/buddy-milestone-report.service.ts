import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityKind, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { BuddyConsentService } from "./buddy-consent.service.ts";
import { enqueueBuddyGrowthEvent } from "./buddy-growth-events.ts";
import { qualifyBuddyGrowthRecord, weeklyActiveGrowthRelationship, type BuddyQualifiedAction } from "./buddy-retention-qualification.ts";
import { weeklyWindow } from "./buddy-joint-goal.service.ts";

const sourceKinds: FrogSleepEntityKind[] = ["buddy_interaction", "buddy_joint_activity",
  "buddy_goal_contribution", "buddy_joint_goal"];

/** Generates deduplicated milestones and consent-filtered viewer-specific weekly reports. */
export class BuddyMilestoneReportService {
  constructor(private readonly database: ApplicationDatabase) {}

  async processBatch(now = new Date()) {
    const relationships = await this.activeRelationships();
    let milestones = 0; let reports = 0;
    for (const relationship of relationships) {
      const viewers = [relationship.ownerUserId, relationship.partnerUserId].filter(Boolean) as string[];
      const timezoneByViewer = await this.timezones(viewers);
      const actions = await this.actions(relationship.id);
      milestones += await this.generateMilestones(relationship, actions, now);
      for (const viewer of viewers) {
        const generated = await this.generateReport(relationship, viewer, timezoneByViewer[viewer] ?? "UTC", actions, now);
        if (generated) reports += 1;
      }
    }
    return { relationships: relationships.length, milestones, reports };
  }

  async listMilestones(userId: string, relationshipId?: string) {
    const relationships = await this.viewerRelationships(userId, relationshipId);
    const ids = new Set(relationships.map((item) => item.id));
    const records = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "buddy_milestone", limit: 200 });
    return { milestones: records.filter((item) => item.relationshipId && ids.has(item.relationshipId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(toMilestone) };
  }

  async listReports(userId: string, relationshipId?: string) {
    const relationships = await this.viewerRelationships(userId, relationshipId);
    const ids = new Set(relationships.map((item) => item.id));
    const records = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "buddy_weekly_report", ownerUserId: userId, limit: 200 });
    const reports = [];
    for (const record of records.filter((item) => item.relationshipId && ids.has(item.relationshipId))) {
      reports.push(await this.filteredReport(userId, record));
    }
    return { reports: reports.sort((left, right) =>
      String(right.window_start).localeCompare(String(left.window_start)) || Number(right.version) - Number(left.version)) };
  }

  async report(userId: string, reportId: string) {
    const record = await this.database.findFrogSleepEntity("buddy_weekly_report", FROGSLEEP_APP_ID, reportId);
    if (!record || record.ownerUserId !== userId || !record.relationshipId) unavailable();
    await this.viewerRelationships(userId, record.relationshipId);
    return await this.filteredReport(userId, record);
  }

  private async generateMilestones(relationship: FrogSleepEntityRecord, actions: BuddyQualifiedAction[], now: Date) {
    const current = weeklyWindow(now, "UTC");
    const windowStart = new Date(new Date(current.start).getTime() - 7 * 86_400_000).toISOString();
    const rules = [
      { key: "first_meaningful_interaction", met: actions.some((item) => item.type === "interaction"), window: "lifetime" },
      { key: "first_joint_action", met: actions.some((item) => item.type === "joint_action"), window: "lifetime" },
      { key: "weekly_two_growth_actions", met: weeklyActiveGrowthRelationship(actions.filter((item) =>
        item.occurredAt >= windowStart && item.occurredAt < current.start)), window: windowStart.slice(0, 10) },
    ];
    let count = 0;
    for (const rule of rules.filter((item) => item.met)) {
      const existing = await this.findByPayload("buddy_milestone", relationship.id,
        (item) => item.payload.rule_key === rule.key && item.payload.window_key === rule.window);
      if (existing) continue;
      await this.database.withExclusiveSession(async () => {
        const created = await this.createMilestone(relationship, rule.key, rule.window, now.toISOString());
        await Promise.all([relationship.ownerUserId!, relationship.partnerUserId!].map((recipientUserId) =>
          enqueueBuddyGrowthEvent(this.database, { recipientUserId, eventType: "milestone_reached",
            targetType: "buddy_milestone", targetId: created.id, relationshipId: relationship.id,
            deduplicationKey: `milestone:${created.id}:${recipientUserId}` })));
      });
      count += 1;
    }
    return count;
  }

  private async createMilestone(relationship: FrogSleepEntityRecord, ruleKey: string, windowKey: string, now: string) {
    const record: FrogSleepEntityRecord = { id: randomId("buddy_milestone"), appId: FROGSLEEP_APP_ID,
      kind: "buddy_milestone", ownerUserId: relationship.ownerUserId, partnerUserId: relationship.partnerUserId,
      relationshipId: relationship.id, status: "reached", payload: { rule_key: ruleKey, window_key: windowKey },
      createdAt: now, updatedAt: now };
    await this.database.insertFrogSleepEntity(record); return record;
  }

  private async generateReport(relationship: FrogSleepEntityRecord, viewer: string, timezone: string,
    actions: BuddyQualifiedAction[], now: Date) {
    const current = weeklyWindow(now, timezone);
    const start = new Date(new Date(current.start).getTime() - 7 * 86_400_000).toISOString();
    const end = current.start; const windowActions = actions.filter((item) => item.occurredAt >= start && item.occurredAt < end);
    const content = await this.reportContent(relationship, viewer, windowActions);
    const contentHash = hash(content);
    const existing = (await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID,
      kind: "buddy_weekly_report", ownerUserId: viewer, relationshipId: relationship.id, limit: 100 }))
      .filter((item) => item.payload.window_start === start).sort((a, b) => Number(b.payload.version) - Number(a.payload.version));
    if (existing[0]?.payload.content_hash === contentHash) return undefined;
    const version = Number(existing[0]?.payload.version ?? 0) + 1; const timestamp = now.toISOString();
    const record: FrogSleepEntityRecord = { id: randomId("buddy_report"), appId: FROGSLEEP_APP_ID,
      kind: "buddy_weekly_report", ownerUserId: viewer, partnerUserId: otherUser(relationship, viewer),
      relationshipId: relationship.id, status: "ready", startsAt: start, endsAt: end,
      payload: { window_start: start, window_end: end, timezone, version, content_hash: contentHash, content },
      createdAt: timestamp, updatedAt: timestamp };
    await this.database.withExclusiveSession(async () => {
      await this.database.insertFrogSleepEntity(record);
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: viewer, eventType: "weekly_report_ready",
        targetType: "buddy_weekly_report", targetId: record.id, relationshipId: relationship.id,
        deduplicationKey: `weekly-report:${relationship.id}:${viewer}:${start}:v${version}` });
    });
    return record;
  }

  private async reportContent(relationship: FrogSleepEntityRecord, viewer: string, actions: BuddyQualifiedAction[]) {
    const partner = otherUser(relationship, viewer); const own = summarize(actions.filter((item) => item.userId === viewer));
    const content: Record<string, unknown> = { viewer: own, joint_actions: actions.filter((item) => item.type === "joint_action").length,
      encouragements: actions.filter((item) => item.type === "interaction").length,
      weekly_active_growth_relationship: weeklyActiveGrowthRelationship(actions), next_action: "choose_next_goal" };
    if (await this.canView(viewer, relationship.id, "weekly_trend")) {
      content.partner = summarize(actions.filter((item) => item.userId === partner));
    }
    return content;
  }

  private async filteredReport(viewer: string, record: FrogSleepEntityRecord) {
    const content = { ...objectPayload(record.payload.content) };
    if (!await this.canView(viewer, record.relationshipId!, "weekly_trend")) delete content.partner;
    return { id: record.id, relationship_id: record.relationshipId, window_start: record.payload.window_start,
      window_end: record.payload.window_end, timezone: record.payload.timezone, version: record.payload.version,
      state: content.partner ? "ready" : "redacted", content, created_at: record.createdAt };
  }

  private async canView(viewer: string, relationshipId: string, category: "weekly_trend") {
    try { await new BuddyConsentService(this.database).assertAuthorized(viewer, relationshipId, category); return true; }
    catch { return false; }
  }

  private async actions(relationshipId: string) {
    const records = (await Promise.all(sourceKinds.map((kind) => this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind, relationshipId, limit: 500 })))).flat();
    return records.map(qualifyBuddyGrowthRecord).filter((item): item is BuddyQualifiedAction => Boolean(item));
  }

  private async activeRelationships() {
    const records = (await Promise.all((["sleep_relationship", "focus_relationship"] as FrogSleepEntityKind[])
      .map((kind) => this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, limit: 500 })))).flat();
    return records.filter((item) => ["active", "accepted"].includes(item.status ?? ""));
  }

  private async viewerRelationships(userId: string, relationshipId?: string) {
    const relationships = (await this.activeRelationships()).filter((item) =>
      [item.ownerUserId, item.partnerUserId].includes(userId) && (!relationshipId || item.id === relationshipId));
    if (relationshipId && relationships.length === 0) unavailable(); return relationships;
  }

  private async timezones(viewers: string[]) {
    const result: Record<string, string> = {};
    for (const viewer of viewers) {
      const devices = await this.database.listFrogSleepDevices({ appId: FROGSLEEP_APP_ID, userId: viewer });
      result[viewer] = devices.find((item) => item.timezone)?.timezone ?? "UTC";
    }
    return result;
  }

  private async findByPayload(kind: "buddy_milestone", relationshipId: string,
    predicate: (record: FrogSleepEntityRecord) => boolean) {
    return (await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind, relationshipId, limit: 500 })).find(predicate);
  }
}

function summarize(actions: BuddyQualifiedAction[]) {
  return { verified_progress: actions.filter((item) => item.type === "verified_progress").length,
    interactions: actions.filter((item) => item.type === "interaction").length,
    joint_actions: actions.filter((item) => item.type === "joint_action").length,
    goals_completed: actions.filter((item) => item.type === "goal_completed").length };
}

function otherUser(relationship: FrogSleepEntityRecord, viewer: string) {
  return relationship.ownerUserId === viewer ? relationship.partnerUserId! : relationship.ownerUserId!;
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function objectPayload(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function toMilestone(record: FrogSleepEntityRecord) { return { id: record.id, relationship_id: record.relationshipId,
  rule_key: record.payload.rule_key, window_key: record.payload.window_key, reached_at: record.createdAt }; }
function unavailable(): never { forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy growth artifact is unavailable."); }
