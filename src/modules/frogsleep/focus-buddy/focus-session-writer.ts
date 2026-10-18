import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseIsoTimestamp, parseFiniteNumber } from "../frogsleep-validation.ts";
import { isActiveFocusSessionStatus } from "./focus-buddy-presence.ts";
import { allBuddyRecords } from "../buddy-growth/buddy-completion-facts.ts";

/** Stores stable client session identities and only advances live records into terminal results. */
export async function storeFocusSession(database: ApplicationDatabase, userId: string, input: Record<string, unknown>) {
  const session = focusRecord(userId, input);
  return await database.withExclusiveSession(async () => {
    const records = await allBuddyRecords(database, { kind: "focus_session", ownerUserId: userId });
    const clientId = session.payload.client_session_id;
    const previous = records.find(item => typeof clientId === "string" && clientId
      ? item.payload.client_session_id === clientId
      : item.startsAt === session.startsAt && item.endsAt === session.endsAt && item.status === session.status);
    if (previous) {
      if (isActiveFocusSessionStatus(previous.status ?? "") && !isActiveFocusSessionStatus(session.status ?? "") &&
        previous.startsAt === session.startsAt) {
        return (await database.updateFrogSleepEntity("focus_session", FROGSLEEP_APP_ID, previous.id,
          { ...session, id: previous.id, createdAt: previous.createdAt }))!;
      }
      return previous;
    }
    await database.insertFrogSleepEntity(session);
    return session;
  });
}

function focusRecord(userId: string, input: Record<string, unknown>): FrogSleepEntityRecord {
  const now = new Date().toISOString();
  const startedAt = parseIsoTimestamp(input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime ?? now, "started_at");
  const endedAt = parseIsoTimestamp(input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime ?? now, "ended_at");
  if (endedAt < startedAt) badRequest("REQ_INVALID_BODY", "ended_at must be after started_at.");
  const status = String(input.status ?? "completed");
  if (!["completed", "abandoned", "interrupted", "cancelled"].includes(status) && !isActiveFocusSessionStatus(status)) {
    badRequest("REQ_INVALID_BODY", "Unsupported focus session status.");
  }
  const room = input.room ?? input.room_id ?? input.roomId;
  const goal = input.goal ?? input.goal_tag ?? input.goalTag;
  const actual = number(input.actual_minutes ?? input.actualMinutes ?? input.minutes ??
    Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000)), "actual_minutes", 1440);
  return { id: randomId("focus_session"), appId: FROGSLEEP_APP_ID, kind: "focus_session", ownerUserId: userId,
    status, startsAt: startedAt, endsAt: endedAt, createdAt: now, updatedAt: now,
    payload: { client_session_id: input.session_id ?? input.sessionId, room, room_id: room, goal, goal_tag: goal,
      planned_minutes: number(input.planned_minutes ?? input.plannedMinutes ?? input.minutes ?? 0, "planned_minutes", 1440),
      actual_minutes: actual, minutes: actual,
      interrupt_count: number(input.interrupt_count ?? input.interruptCount ?? 0, "interrupt_count", 1000),
      session_type: input.session_type ?? input.sessionType, result: input.result } };
}

function number(value: unknown, name: string, max: number) {
  return parseFiniteNumber(value, name, { min: 0, max });
}
