import { createHash } from "node:crypto";
import { badRequest } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseFiniteNumber, parseIsoTimestamp } from "../frogsleep-validation.ts";
import { isActiveFocusSessionStatus } from "./focus-buddy-presence.ts";

const completedStatuses = new Set(["completed", "abandoned", "interrupted", "cancelled"]);
const maxMinutes = 24 * 60;

export function parseFocusClientSessionId(input: Record<string, unknown>): string | undefined {
  const snake = input.session_id, camel = input.sessionId;
  if (snake === undefined && camel === undefined) return undefined;
  if (snake !== undefined && camel !== undefined && snake !== camel) {
    badRequest("REQ_INVALID_BODY", "session_id and sessionId must match.");
  }
  const value = snake !== undefined ? snake : camel;
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > 128) {
    badRequest("REQ_INVALID_BODY", "session_id must be a non-blank string of at most 128 characters.");
  }
  return value;
}

function dates(input: Record<string, unknown>, now: string) {
  const start = input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime;
  const end = input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime;
  const startedAt = parseIsoTimestamp(start ?? now, "started_at");
  const endedAt = parseIsoTimestamp(end ?? now, "ended_at");
  if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
    badRequest("REQ_INVALID_BODY", "ended_at must be after started_at.");
  }
  return { startedAt, endedAt, startProvided: start != null, endProvided: end != null };
}

function normalizedPayload(input: Record<string, unknown>, window: ReturnType<typeof dates>) {
  const planned = parseFiniteNumber(input.planned_minutes ?? input.plannedMinutes ?? input.minutes ?? 0, "planned_minutes", { min: 0, max: maxMinutes });
  const actual = input.actual_minutes ?? input.actualMinutes ?? input.minutes;
  const elapsed = Math.max(0, Math.round((Date.parse(window.endedAt) - Date.parse(window.startedAt)) / 60000));
  const minutes = parseFiniteNumber(actual ?? elapsed, "actual_minutes", { min: 0, max: maxMinutes });
  const interrupts = parseFiniteNumber(input.interrupt_count ?? input.interruptCount ?? 0, "interrupt_count", { min: 0, max: 1000 });
  const room = input.room ?? input.room_id ?? input.roomId, goal = input.goal ?? input.goal_tag ?? input.goalTag;
  return { client_session_id: parseFocusClientSessionId(input), room, room_id: room, goal, goal_tag: goal,
    planned_minutes: planned, actual_minutes: minutes, interrupt_count: interrupts, minutes,
    session_type: input.session_type ?? input.sessionType, result: input.result };
}

function sortedJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJSON);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sortedJSON(item)]));
  return value;
}

function fingerprint(input: Record<string, unknown>, record: FrogSleepEntityRecord, window: ReturnType<typeof dates>): string {
  const payload = { ...record.payload };
  if ((input.actual_minutes ?? input.actualMinutes ?? input.minutes) == null) {
    delete payload.actual_minutes; delete payload.minutes;
  }
  const semantic = { payload, status: record.status,
    started_at: window.startProvided ? record.startsAt : null, ended_at: window.endProvided ? record.endsAt : null };
  return createHash("sha256").update(JSON.stringify(sortedJSON(semantic))).digest("hex");
}

export function buildFocusSessionReport(userId: string, input: Record<string, unknown>): FrogSleepEntityRecord {
  const createdAt = new Date().toISOString(), window = dates(input, createdAt);
  const status = String(input.status ?? "completed");
  if (!completedStatuses.has(status) && !isActiveFocusSessionStatus(status)) {
    badRequest("REQ_INVALID_BODY", "Unsupported focus session status.");
  }
  const record: FrogSleepEntityRecord = { id: randomId("focus_session"), appId: FROGSLEEP_APP_ID,
    kind: "focus_session", ownerUserId: userId, status, startsAt: window.startedAt, endsAt: window.endedAt,
    payload: normalizedPayload(input, window), createdAt, updatedAt: createdAt };
  if (record.payload.client_session_id !== undefined) record.payload._report_fingerprint = fingerprint(input, record, window);
  return record;
}
