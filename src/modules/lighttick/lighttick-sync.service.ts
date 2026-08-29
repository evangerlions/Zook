import { ApplicationError } from "../../shared/errors.ts";
import { randomId, sha256 } from "../../shared/utils.ts";
import { transitionTask } from "./lighttick-state-machines.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";
import type { LightTickTaskService } from "./lighttick-task.service.ts";

export interface LightTickSyncOperationInput {
  operation_id: string; device_id: string; entity_type: string; entity_id: string; action: string;
  base_version: number; client_occurred_at: string; payload: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export class LightTickSyncService {
  constructor(private readonly repository: LightTickRepository, private readonly tasks: LightTickTaskService,
    private readonly cursorSecret = "lighttick-sync-v1", private readonly clock = () => new Date()) {}

  async push(owner: LightTickOwner, operations: LightTickSyncOperationInput[]) {
    if (!Array.isArray(operations) || operations.length < 1) throw new ApplicationError(400, "REQ_INVALID_BODY", "Sync operations are required.");
    if (operations.length > 50) throw new ApplicationError(413, "LIGHTTICK_SYNC_BATCH_TOO_LARGE", "Sync batch exceeds 50 operations.");
    const results = [];
    for (const operation of operations) results.push(await this.apply(owner, operation));
    return { results, server_time: this.clock().toISOString() };
  }

  private async apply(owner: LightTickOwner, operation: LightTickSyncOperationInput) {
    if (!operation?.operation_id || !operation.device_id || !operation.entity_id || !Number.isInteger(operation.base_version))
      return { operation_id: operation?.operation_id ?? "invalid", status: "rejected", error_code: "LIGHTTICK_SYNC_OPERATION_REJECTED" };
    const hash = sha256(canonical(operation)); const existing = await this.repository.getOperation(owner, operation.operation_id);
    if (existing) {
      if (existing.payloadHash !== hash) return { operation_id: operation.operation_id, status: "rejected", error_code: "LIGHTTICK_IDEMPOTENCY_MISMATCH" };
      return { ...existing.resultPayload, status: "duplicate" };
    }
    let result: Record<string, unknown>;
    try {
      if (operation.entity_type !== "task" || !["start", "complete", "skip", "defer", "cancel", "delete"].includes(operation.action))
        throw new ApplicationError(400, "LIGHTTICK_SYNC_OPERATION_REJECTED", "Offline action is not supported.");
      const payload = operation.payload; const command: any = operation.action === "complete"
        ? { action: "complete", actualMinutes: payload.actual_duration_minutes, notes: payload.note }
        : operation.action === "skip" ? { action: "skip", reason: payload.reason_code ?? "other", notes: payload.reason_note }
        : operation.action === "defer" ? { action: "defer", scheduledFor: payload.scheduled_for, notes: payload.reason_note }
        : { action: operation.action };
      const task = operation.action === "delete"
        ? await this.deleteTask(owner, operation.entity_id, operation.base_version)
        : await this.tasks.command(owner, operation.entity_id, operation.base_version, command);
      result = { operation_id: operation.operation_id, status: "accepted", entity_type: "task", entity_id: task.id, version: task.version };
    } catch (error) {
      if (error instanceof ApplicationError && ["LIGHTTICK_VERSION_CONFLICT", "LIGHTTICK_STATE_TRANSITION_INVALID"].includes(error.code)) {
        const task = await this.repository.getTask(owner, operation.entity_id);
        result = { operation_id: operation.operation_id, status: "conflict", entity_type: operation.entity_type,
          entity_id: operation.entity_id, version: task?.version ?? 0, server_snapshot: task,
          conflict_fields: ["status", "version"], resolution_actions: ["keep_server", "refresh_and_retry"], error_code: error.code };
      } else result = { operation_id: operation.operation_id, status: "rejected",
        error_code: error instanceof ApplicationError ? error.code : "LIGHTTICK_SYNC_OPERATION_REJECTED" };
    }
    const now = this.clock().toISOString();
    await this.repository.saveOperation({ ...owner, operationId: operation.operation_id, deviceId: operation.device_id,
      payloadHash: hash, entityType: operation.entity_type, entityId: operation.entity_id, action: operation.action,
      requestPayload: operation as unknown as Record<string, unknown>, resultPayload: result, status: String(result.status), createdAt: now, updatedAt: now });
    return result;
  }

  private async deleteTask(owner: LightTickOwner, taskId: string, baseVersion: number) {
    const current = await this.repository.getTask(owner, taskId);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Task was not found.");
    const timestamp = this.clock().toISOString(); const status = transitionTask(current.status as any, "cancelled");
    return await this.repository.saveTask({ ...current, status, updatedAt: timestamp }, {
      event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: taskId,
        eventType: "task_deleted", aggregateVersion: baseVersion + 1, payload: {}, occurredAt: timestamp, createdAt: timestamp },
      change: { ...owner, entityType: "task", entityId: taskId, entityVersion: baseVersion + 1,
        operation: "delete", changedAt: timestamp },
    }, baseVersion);
  }

  async pull(owner: LightTickOwner, cursor: string | undefined, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ApplicationError(400, "REQ_INVALID_QUERY", "Sync limit is invalid.");
    const after = cursor ? this.decodeCursor(owner, cursor) : 0; const rows = await this.repository.pullChanges(owner, after, limit + 1);
    const page = rows.slice(0, limit); const next = page.at(-1)?.sequence ?? after;
    return { changes: page.map(row => ({ sequence: row.sequence, entity_type: row.entityType, entity_id: row.entityId,
      version: row.entityVersion, operation: row.operation, snapshot: row.snapshot, changed_at: row.changedAt })),
      next_cursor: this.encodeCursor(owner, next), has_more: rows.length > limit, server_time: this.clock().toISOString() };
  }
  private encodeCursor(owner: LightTickOwner, sequence: number) {
    const subject = `${owner.appId}:${owner.userId}:${sequence}`; return Buffer.from(JSON.stringify({ s: sequence, h: sha256(`${this.cursorSecret}:${subject}`) })).toString("base64url");
  }
  private decodeCursor(owner: LightTickOwner, cursor: string) {
    try {
      const decoded = Buffer.from(cursor, "base64url");
      if (decoded.toString("base64url") !== cursor) throw new Error("invalid");
      const value = JSON.parse(decoded.toString("utf8"));
      const subject = `${owner.appId}:${owner.userId}:${value.s}`;
      if (!Number.isInteger(value.s) || value.s < 0 || value.h !== sha256(`${this.cursorSecret}:${subject}`)) throw new Error("invalid");
      return value.s as number;
    } catch { throw new ApplicationError(400, "LIGHTTICK_SYNC_CURSOR_INVALID", "Sync cursor is invalid or belongs to another user."); }
  }
}
