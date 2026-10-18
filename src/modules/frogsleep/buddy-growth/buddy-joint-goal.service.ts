import { isBuddyAuthorizationDenied } from "./buddy-artifact-redaction.ts";
import { buddyRelationshipSlotKeys, findBuddyRelationship } from "./buddy-relationship-facts.ts";
import { completionFacts, goalProgress } from "./buddy-completion-facts.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { FrogSleepEntityKind, FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { assertBuddyDataAuthorized } from "./buddy-protected-access.ts";
import { buddyGoalTypes, type BuddyGoalType } from "./buddy-growth-contract.ts";
import { enqueueBuddyGrowthEvent } from "./buddy-growth-events.ts";
import { BuddyGoalRepository, type BuddyGoalRepositoryProtocol } from "./buddy-goal-repository.ts";

type GoalAction = "accept" | "adjust" | "pause" | "complete";

/** Coordinates supported joint goals, bilateral consent, verified progress, and optimistic versioning. */
export class BuddyJointGoalService {
  private readonly repository: BuddyGoalRepositoryProtocol;

  constructor(private readonly database: ApplicationDatabase, repository?: BuddyGoalRepositoryProtocol) {
    this.repository = repository ?? new BuddyGoalRepository(database);
  }

  async list(userId: string, relationshipId?: string) {
    const records = await this.repository.listGoals(userId, relationshipId);
    const goals = [];
    for (const item of records) {
      try { await this.relationship(userId, item.relationshipId!); goals.push(await this.toGoal(userId, item)); }
      catch (error) { if (!isBuddyAuthorizationDenied(error)) throw error; }
    }
    return { goals };
  }

  async create(userId: string, input: Record<string, unknown>) {
    const relationship = await this.relationship(userId, requiredString(input.relationship_id));
    const type = goalType(input.type);
    assertGoalDomain(type, relationship);
    const target = goalTarget(type, input.target);
    const timezone = validTimezone(input.timezone);
    const idempotencyKey = requiredString(input.idempotency_key);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
      await this.relationship(userId, relationship.id);
      const existing = (await this.repository.listGoals(userId, relationship.id))
        .find((item) => item.ownerUserId === userId && item.payload.idempotency_key === idempotencyKey);
      if (existing) return await this.toGoal(userId, existing);
      const now = new Date();
      const record = goalRecord(userId, this.otherUserId(relationship, userId), relationship.id,
        { type, target, timezone, idempotencyKey, window: weeklyWindow(now, timezone) }, now.toISOString());
      await this.repository.insertGoal(record);
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: record.partnerUserId!,
        eventType: "goal_updated", targetType: "buddy_joint_goal", targetId: record.id,
        relationshipId: relationship.id, deduplicationKey: `goal:${record.id}:proposed` });
      return await this.toGoal(userId, record);
    });
  }

  async act(userId: string, goalId: string, action: GoalAction, input: Record<string, unknown>) {
    const initial = await this.authorizedGoal(userId, goalId);
    const relationship = await this.relationship(userId, initial.relationshipId!);
    const expectedVersion = positiveInteger(input.expected_version);
    const idempotencyKey = requiredString(input.idempotency_key);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
      const goal = await this.authorizedGoal(userId, goalId);
      const actionKeys = objectValue(goal.payload.action_keys);
      if (actionKeys[idempotencyKey]) return await this.toGoal(userId, goal);
      if (Number(goal.payload.version) !== expectedVersion) conflict("REQ_INVALID_BODY", "Joint goal version conflict.");
      if (action === "adjust") assertGoalDomain(goalType(input.type ?? goal.payload.type), relationship);
      if (action === "complete") {
        const progress = await this.toGoal(userId, goal, false);
        if (!Object.values(progress.participant_progress).every(value => value >= Number(goal.payload.target))) {
          conflict("REQ_INVALID_BODY", "Both participants must reach the goal target.");
        }
      }
      const updated = applyAction(goal, userId, action, input, idempotencyKey);
      const stored = await this.repository.updateGoal(goal.id, updated);
      if (!stored) conflict("REQ_INVALID_BODY", "Joint goal is unavailable.");
      await enqueueBuddyGrowthEvent(this.database, { recipientUserId: this.otherUserId(goal, userId),
        eventType: "goal_updated", targetType: "buddy_joint_goal", targetId: goal.id,
        relationshipId: goal.relationshipId!, deduplicationKey: `goal:${goal.id}:${expectedVersion + 1}` });
      return await this.toGoal(userId, stored);
    });
  }

  async recordVerifiedContribution(input: { relationshipId: string; userId: string; sourceEventId: string;
    sourceKind: "focus_session" | "sleep_summary" | "buddy_interaction" | "buddy_joint_activity"; amount: number; occurredAt: string }) {
    const relationship = await this.relationship(input.userId, input.relationshipId);
    if (await this.repository.findContributionBySource(input.relationshipId, input.sourceEventId)) return;
    if (!Number.isFinite(input.amount) || input.amount <= 0) badRequest("REQ_INVALID_BODY", "Invalid contribution amount.");
    const source = await this.database.findFrogSleepEntity(input.sourceKind, FROGSLEEP_APP_ID, input.sourceEventId);
    if (!source || ![source.ownerUserId, source.partnerUserId].includes(input.userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Verified contribution source is unavailable.");
    }
    const now = new Date().toISOString();
    await this.repository.insertContribution({ id: randomId("buddy_contribution"), appId: FROGSLEEP_APP_ID,
      kind: "buddy_goal_contribution", ownerUserId: input.userId,
      partnerUserId: this.otherUserId(relationship, input.userId), relationshipId: input.relationshipId,
      occurredAt: input.occurredAt, status: "verified", payload: { source_event_id: input.sourceEventId,
        source_kind: input.sourceKind, amount: input.amount }, createdAt: now, updatedAt: now });
  }

  private async authorizedGoal(userId: string, goalId: string) {
    const goal = await this.repository.findGoal(goalId);
    if (!goal || !goal.relationshipId || ![goal.ownerUserId, goal.partnerUserId].includes(userId)) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Joint goal is unavailable.");
    }
    await this.relationship(userId, goal.relationshipId);
    return goal;
  }

  private async relationship(userId: string, relationshipId: string) {
    const row = await findBuddyRelationship(this.database, relationshipId);
    const relationship = row && [row.ownerUserId, row.partnerUserId].includes(userId)
      && ["active", "accepted"].includes(row.status ?? "") ? row : undefined;
    if (!relationship) forbidden("AUTH_APP_SCOPE_MISMATCH", "Buddy relationship is unavailable.");
    await assertBuddyDataAuthorized(this.database, userId, relationshipId, "shared_activity");
    return relationship;
  }

  private async toGoal(userId: string, record: FrogSleepEntityRecord, reconcile = true) {
    const relationship = await this.relationship(userId, record.relationshipId!);
    return await this.database.withFrogSleepBuddyCommandTransaction(buddyRelationshipSlotKeys(relationship), async () => {
      record = await this.authorizedGoal(userId, record.id);
      const participantProgress: Record<string, number> = {};
      const from = String(record.payload.accepted_at ?? record.payload.window_start);
      for (const id of [record.ownerUserId!, record.partnerUserId!]) {
        participantProgress[id] = record.status === "proposed" ? 0 : goalProgress(
          await completionFacts(this.database, relationship, id), String(record.payload.type),
          String(record.payload.timezone), from, String(record.payload.window_end));
      }
      if (reconcile && record.status === "active" && Object.values(participantProgress).every(value => value >= Number(record.payload.target))) {
        const updated = await this.repository.updateGoal(record.id, { status: "completed",
          payload: { ...record.payload, version: Number(record.payload.version) + 1 }, updatedAt: new Date().toISOString() });
        if (updated) record = updated;
      }
      return { id: record.id, relationship_id: record.relationshipId, type: record.payload.type,
        target: record.payload.target, timezone: record.payload.timezone, window_start: record.payload.window_start,
        window_end: record.payload.window_end, status: record.status, version: record.payload.version,
        participant_consents: record.payload.participant_consents, participant_progress: participantProgress,
        viewer_user_id: userId, updated_at: record.updatedAt };
    });
  }

  private otherUserId(record: FrogSleepEntityRecord, userId: string) {
    return record.ownerUserId === userId ? record.partnerUserId! : record.ownerUserId!;
  }
}

function goalRecord(ownerUserId: string, partnerUserId: string, relationshipId: string,
  input: { type: BuddyGoalType; target: number; timezone: string; idempotencyKey: string;
    window: { start: string; end: string; key: string } }, now: string): FrogSleepEntityRecord {
  return { id: randomId("buddy_goal"), appId: FROGSLEEP_APP_ID, kind: "buddy_joint_goal",
    ownerUserId, partnerUserId, relationshipId, status: "proposed", startsAt: input.window.start,
    endsAt: input.window.end, payload: { type: input.type, target: input.target, timezone: input.timezone,
      timezone_source: "proposer", window_start: input.window.start, window_end: input.window.end,
      window_key: input.window.key, version: 1, idempotency_key: input.idempotencyKey,
      participant_consents: { [ownerUserId]: "accepted", [partnerUserId]: "pending" }, action_keys: {} },
    createdAt: now, updatedAt: now };
}

function applyAction(goal: FrogSleepEntityRecord, userId: string, action: GoalAction,
  input: Record<string, unknown>, idempotencyKey: string): Partial<FrogSleepEntityRecord> {
  const version = Number(goal.payload.version) + 1;
  const consents = objectValue(goal.payload.participant_consents);
  if (action === "accept") {
    if (goal.status !== "proposed" || consents[userId] !== "pending") conflict("REQ_INVALID_BODY", "Joint goal cannot be accepted.");
    consents[userId] = "accepted";
    goal.payload.accepted_at = new Date().toISOString();
  } else if (action === "adjust") {
    const type = goalType(input.type ?? goal.payload.type);
    goal.payload.type = type; goal.payload.target = goalTarget(type, input.target);
    for (const participant of Object.keys(consents)) consents[participant] = participant === userId ? "accepted" : "pending";
  } else if (action === "pause" && !["active", "proposed"].includes(goal.status ?? "")) {
    conflict("REQ_INVALID_BODY", "Joint goal cannot be paused.");
  } else if (action === "complete" && !["active", "paused"].includes(goal.status ?? "")) {
    conflict("REQ_INVALID_BODY", "Joint goal cannot be completed.");
  }
  const status = action === "accept" ? "active" : action === "adjust" ? "proposed" : action === "pause" ? "paused" : "completed";
  const actionKeys = objectValue(goal.payload.action_keys); actionKeys[idempotencyKey] = action;
  return { status, payload: { ...goal.payload, participant_consents: consents, action_keys: actionKeys, version },
    updatedAt: new Date().toISOString() };
}

function assertGoalDomain(type: BuddyGoalType, relationship: FrogSleepEntityRecord) {
  if ((type.startsWith("focus_") && relationship.kind !== "focus_relationship") ||
    (type === "sleep_schedule_days" && relationship.kind !== "sleep_relationship")) {
    badRequest("REQ_INVALID_BODY", "Goal type must match the relationship domain.");
  }
}

function goalType(value: unknown): BuddyGoalType {
  const type = String(value ?? "") as BuddyGoalType;
  if (!buddyGoalTypes.includes(type)) badRequest("REQ_INVALID_BODY", "Unsupported joint goal type.");
  return type;
}

function goalTarget(type: BuddyGoalType, value: unknown) {
  const target = Number(value); const maximum = type === "focus_minutes" ? 10_080 : 7;
  if (!Number.isInteger(target) || target < 1 || target > maximum) badRequest("REQ_INVALID_BODY", "Invalid joint goal target.");
  return target;
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) badRequest("REQ_INVALID_BODY", "Required value is invalid.");
  return value.trim();
}

function positiveInteger(value: unknown) {
  const number = Number(value); if (!Number.isInteger(number) || number < 1) badRequest("REQ_INVALID_BODY", "Expected version is invalid.");
  return number;
}

function objectValue(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, string>) } : {};
}

function validTimezone(value: unknown) {
  const timezone = requiredString(value);
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { badRequest("REQ_INVALID_BODY", "Invalid timezone."); }
  return timezone;
}

export function weeklyWindow(now: Date, timezone: string) {
  const parts = localDateParts(now, timezone); const weekday = isoWeekday(parts.year, parts.month, parts.day);
  const monday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - weekday + 1));
  const next = new Date(monday.getTime() + 7 * 86_400_000);
  const start = zonedMidnight(monday, timezone); const end = zonedMidnight(next, timezone);
  return { start: start.toISOString(), end: end.toISOString(), key: start.toISOString().slice(0, 10) };
}

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function isoWeekday(year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); return weekday === 0 ? 7 : weekday;
}

function zonedMidnight(localDate: Date, timezone: string) {
  const desired = localDate.getTime();
  let guess = new Date(desired);
  for (let index = 0; index < 2; index += 1) {
    const parts = localDateTimeParts(guess, timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = new Date(desired - (represented - guess.getTime()));
  }
  return guess;
}

function localDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"),
    minute: value("minute"), second: value("second") };
}
