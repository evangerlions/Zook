import { badRequest } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { parseFiniteNumber, parseIsoTimestamp } from "../frogsleep-validation.ts";
import { personalRecordId, validatePersonalRecordOwner } from "../product-data/personal-record-upload.ts";
import { isActiveFocusSessionStatus } from "./focus-buddy-presence.ts";

const nowIso = () => new Date().toISOString();
const terminalStatuses = new Set(["completed", "abandoned", "interrupted", "cancelled"]);
const MAX_FOCUS_SESSION_MINUTES = 24 * 60;
const minutesBetween = (start: string, end: string) => Math.max(0,
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));

export function buildFocusSessionUpload(userId: string, input: Record<string, unknown>, previous?: FrogSleepEntityRecord): FrogSleepEntityRecord {
    validatePersonalRecordOwner(input, userId);
    validateBindingTimes(input);
    const startedAt = parseIsoTimestamp(input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime ?? previous?.startsAt ?? nowIso(), "started_at");
    const endedAt = parseIsoTimestamp(input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime ?? previous?.endsAt ?? nowIso(), "ended_at");
    if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
      badRequest("REQ_INVALID_BODY", "ended_at must be after started_at.");
    }
    const plannedMinutes = parseFiniteNumber(input.planned_minutes ?? input.plannedMinutes ?? input.minutes ?? 0,
      "planned_minutes", { min: 0, max: MAX_FOCUS_SESSION_MINUTES });
    const actualMinutes = parseFiniteNumber(input.actual_minutes ?? input.actualMinutes ?? input.minutes ?? minutesBetween(startedAt, endedAt),
      "actual_minutes", { min: 0, max: MAX_FOCUS_SESSION_MINUTES });
    const interruptCount = parseFiniteNumber(input.interrupt_count ?? input.interruptCount ?? 0,
      "interrupt_count", { min: 0, max: 1000 });
    const status = String(input.status ?? "completed");
    if (!terminalStatuses.has(status) && !isActiveFocusSessionStatus(status)) {
      badRequest("REQ_INVALID_BODY", "Unsupported focus session status.");
    }
    if (input.binding !== undefined && (!terminalStatuses.has(status) || !personalRecordId(input.session_id ?? input.sessionId)))
      badRequest("REQ_INVALID_BODY", "Binding accepts only terminal sessions with a stable session_id.");
    return makeRecord(userId, input, { startedAt, endedAt, plannedMinutes, actualMinutes, interruptCount, status });
}

function makeRecord(userId: string, input: Record<string, unknown>, values: {
  startedAt: string; endedAt: string; plannedMinutes: number; actualMinutes: number; interruptCount: number; status: string;
}): FrogSleepEntityRecord {
    const { startedAt, endedAt, plannedMinutes, actualMinutes, interruptCount, status } = values;
    const room = input.room ?? input.room_id ?? input.roomId;
    const goal = input.goal ?? input.goal_tag ?? input.goalTag;
    const createdAt = nowIso();
    return {
      id: randomId("focus_session"),
      appId: FROGSLEEP_APP_ID,
      kind: "focus_session",
      ownerUserId: userId,
      status,
      startsAt: startedAt,
      endsAt: endedAt,
      payload: makePayload(input, room, goal, plannedMinutes, actualMinutes, interruptCount),
      createdAt,
      updatedAt: createdAt,
    };
}

function validateBindingTimes(input: Record<string, unknown>): void {
  if (input.binding === undefined) return;
  const start = input.started_at ?? input.startedAt ?? input.start_time ?? input.startTime;
  const end = input.ended_at ?? input.endedAt ?? input.end_time ?? input.endTime;
  if (!start || !end) badRequest("REQ_INVALID_BODY", "Binding requires the original session timestamps.");
}

function makePayload(input: Record<string, unknown>, room: unknown, goal: unknown,
  plannedMinutes: number, actualMinutes: number, interruptCount: number): Record<string, unknown> {
    return {
        client_session_id: personalRecordId(input.session_id ?? input.sessionId),
        room,
        room_id: room,
        goal,
        goal_tag: goal,
        planned_minutes: plannedMinutes,
        actual_minutes: actualMinutes,
        interrupt_count: interruptCount,
        minutes: actualMinutes,
        session_type: input.session_type ?? input.sessionType,
        result: input.result,
    };
}
