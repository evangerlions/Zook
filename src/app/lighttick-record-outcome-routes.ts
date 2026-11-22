import { ManualPlanningService } from "../modules/lighttick/manual/manual-planning.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import { sha256 } from "../shared/utils.ts";
import { bodyOf, idempotent, idempotencyKeyOf, numberOf, stringOf } from "./lighttick-v1-http.ts";

export async function handleRecordOutcomeRequest(
  runtime: LightTickRuntime, owner: LightTickOwner, request: HttpRequest, assertActive: () => Promise<void>,
) {
  const route = /^\/api\/v1\/lighttick\/records\/([a-zA-Z0-9_-]{8,128})\/outcomes$/.exec(request.path);
  if (!route || request.method !== "POST") return;
  const recordId = route[1];
  const body = bodyOf(request);
  const kind = body.kind;
  if (kind !== "goal" && kind !== "action") {
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Outcome kind must be goal or action.");
  }
  const title = stringOf(body.title, "title");
  if (title.length > 200) throw new ApplicationError(400, "REQ_FIELD_INVALID", "Outcome title is too long.");
  const version = numberOf(body.base_record_version, "base_record_version");
  const key = idempotencyKeyOf(request);

  await assertActive();
  return idempotent(runtime, owner, request, "record", recordId, "convert:" + kind, async () => {
    await assertActive();
    const record = await runtime.repository.getRecord(owner, recordId);
    if (!record || record.payload.archived_at) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Active record was not found.");
    if (record.version !== version) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Refresh the changed record before converting it.");
    if (kind === "goal") {
      const draft = await runtime.goals.create(owner, { title, description: record.payload.raw_text.trim().slice(0, 4000), constraints: {} });
      const goal = await runtime.goals.transition(owner, draft.id, draft.version, "resume");
      return { kind, id: goal.id, version: goal.version };
    }

    if (process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED === "0") {
      throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "New manual cloud writes are unavailable.");
    }
    const date = stringOf(body.scheduled_for, "scheduled_for");
    const taskId = "record-" + sha256(key + ":task").slice(0, 36);
    const manual = new ManualPlanningService(runtime.repository, undefined, assertActive);
    const draft = await manual.create(owner, sha256(key + ":draft"), {
      goal_id: stringOf(body.goal_id, "goal_id"), title, period_start: date, period_end: date,
      tasks: [{
        id: taskId, title, scheduled_for: date, estimated_minutes: numberOf(body.estimated_minutes, "estimated_minutes"),
        completion_criteria: "", guidance: "",
      }],
      completion_criteria: "",
    });
    const confirmed = await manual.confirm(owner, draft.id, sha256(key + ":confirm"), {
      base_version: draft.version, goal_base_version: draft.goal_version,
    });
    const task = confirmed.tasks[0]!;
    return { kind, id: task.id, version: task.version, scheduled_for: date };
  });
}
