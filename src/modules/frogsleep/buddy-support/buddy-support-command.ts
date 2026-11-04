import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { badRequest } from "../../../shared/errors.ts";
import { BuddySupportAccess } from "./buddy-support-access.ts";
import { appID, digest, failure, fields, identifier, submission, timestamp, unavailable } from "./buddy-support-validation.ts";
import { supportTemplates, type SupportNote, type SupportOperation, type SupportSubmission } from "./buddy-support.types.ts";

/** Atomically creates notes, permissions and acknowledgements with durable outcomes. */
export class BuddySupportCommand {
  private readonly access: BuddySupportAccess;
  constructor(private readonly database: ApplicationDatabase) { this.access = new BuddySupportAccess(database); }
  private get store() { return this.database.getBuddySupportRepository(); }
  async enroll(actor: string, relationship: string) {
    const row = await this.access.relationship(actor, relationship);
    await this.database.withFrogSleepBuddyCommandTransaction(this.access.keys(row), async () => {
      await this.access.relationship(actor, relationship);
      await this.store.enroll(appID, relationship, timestamp());
    });
  }
  async setReceiving(actor: string, relationship: string, input: Record<string, unknown>) {
    fields(input, ["enabled", "expected_revision", "operation_id"]);
    if (typeof input.enabled !== "boolean" || !Number.isInteger(input.expected_revision) || Number(input.expected_revision) < 0) badRequest("REQ_INVALID_BODY", "Invalid receive preference.");
    const id = identifier(input.operation_id);
    const row = await this.access.relationship(actor, relationship, true);
    return await this.database.withFrogSleepBuddyCommandTransaction(this.access.keys(row), async () => {
      await this.requireEnrolled(actor, relationship, true);
      const hash = digest("permission", [relationship, input.enabled, input.expected_revision]);
      const previous = await this.previous(actor, id, hash);
      if (previous) return { permission: previous.result };
      const old = await this.store.permission(appID, relationship, actor);
      if ((old?.revision ?? 0) !== input.expected_revision) failure("BUDDY_SUPPORT_REVISION_CONFLICT");
      const value = { app_id: appID, relationship_id: relationship, recipient_id: actor,
        enabled: input.enabled as boolean, revision: (old?.revision ?? 0) + 1, updated_at: timestamp() };
      await this.store.savePermission(value);
      await this.record(actor, id, relationship, "permission", hash, relationship, value);
      return { permission: value };
    });
  }
  async send(actor: string, input: Record<string, unknown>) {
    const command = submission(input);
    const row = await this.access.relationship(actor, command.relationship_id);
    return await this.database.withFrogSleepBuddyCommandTransaction(this.access.keys(row), async () => {
      const current = await this.requireEnrolled(actor, command.relationship_id);
      const hash = digest("send", command);
      const old = await this.previous(actor, command.operation_id, hash);
      if (old) return { note: await this.project(actor, old.resource_id!), operation_id: command.operation_id };
      const other = this.access.other(current, actor);
      if (!(await this.store.permission(appID, current.id, other))?.enabled) unavailable();
      await this.checkQuota(actor, other);
      await this.validateContent(actor, current, command);
      const note = this.makeNote(actor, other, current, command);
      await this.store.insertNote(note);
      await this.record(actor, command.operation_id, current.id, "send", hash, note.id);
      return { note: await this.project(actor, note.id), operation_id: command.operation_id };
    });
  }
  async resolve(actor: string, id: string, input: Record<string, unknown>) {
    fields(input, ["relationship_id", "submission"]);
    const body = input.submission as Record<string, unknown>;
    const command = submission({ ...body, relationship_id: identifier(input.relationship_id), operation_id: identifier(id) });
    const receipt = await this.store.operation(appID, actor, id);
    if (receipt) {
      if (receipt.request_digest !== digest("send", command)) failure("BUDDY_SUPPORT_OPERATION_CONFLICT");
      return { operation: { operation_id: id, state: receipt.state, resource_id: receipt.resource_id } };
    }
    const row = await this.access.relationship(actor, command.relationship_id, true);
    return await this.database.withFrogSleepBuddyCommandTransaction(this.access.keys(row), async () => {
      await this.access.relationship(actor, command.relationship_id, true);
      const hash = digest("send", command);
      const old = await this.store.operation(appID, actor, id);
      if (old && old.request_digest !== hash) failure("BUDDY_SUPPORT_OPERATION_CONFLICT");
      if (!old) await this.store.saveOperation({ app_id: appID, actor_id: actor, operation_id: id, command_type: "send",
        relationship_id: row.id, request_digest: hash, state: "not_sent", resource_id: null, result: null, created_at: timestamp() });
      const result = (await this.store.operation(appID, actor, id))!;
      return { operation: { operation_id: id, state: result.state, resource_id: result.resource_id } };
    });
  }
  async acknowledge(actor: string, noteID: string, input: Record<string, unknown>) {
    fields(input, ["operation_id"]);
    const id = identifier(input.operation_id);
    const note = await this.store.note(appID, noteID);
    if (!note || note.recipient_id !== actor) unavailable();
    const row = await this.access.relationship(actor, note.relationship_id);
    return await this.database.withFrogSleepBuddyCommandTransaction(this.access.keys(row), async () => {
      await this.access.readable(actor, note);
      const hash = digest("ack", noteID);
      const previous = await this.previous(actor, id, hash);
      if (!previous) {
        await this.store.acknowledge(appID, noteID, actor, timestamp());
        await this.record(actor, id, row.id, "ack", hash, noteID);
      }
      return { note_id: noteID, acknowledged: true };
    });
  }
  private async requireEnrolled(actor: string, id: string, paused = false) {
    const row = await this.access.relationship(actor, id, paused);
    if (!await this.store.isEnrolled(appID, id)) unavailable();
    return row;
  }
  private async previous(actor: string, id: string, hash: string) {
    const old = await this.store.operation(appID, actor, id);
    if (old && old.request_digest !== hash) failure("BUDDY_SUPPORT_OPERATION_CONFLICT");
    if (old?.state === "not_sent") failure("BUDDY_SUPPORT_OPERATION_CLOSED");
    return old;
  }
  private async record(actor: string, id: string, relationship: string, kind: SupportOperation["command_type"], hash: string, resource: string, result: Record<string, unknown> | null = null) {
    await this.store.saveOperation({ app_id: appID, actor_id: actor, operation_id: id, command_type: kind,
      relationship_id: relationship, request_digest: hash, state: "accepted", resource_id: resource, result, created_at: timestamp() });
  }
  private async checkQuota(actor: string, other: string) {
    const recent = await this.store.recentSent(appID, actor, other, new Date(Date.now() - 86400000).toISOString());
    if (recent.length < 3) return;
    const next = new Date(new Date(recent[recent.length - 3]).getTime() + 86400000);
    failure("BUDDY_SUPPORT_LIMIT_REACHED", 429, { next_send_at: next.toISOString(), retry_after_seconds: Math.max(1, Math.ceil((next.getTime() - Date.now()) / 1000)) });
  }
  private async validateContent(actor: string, row: FrogSleepEntityRecord, command: SupportSubmission) {
    if (command.template_key && supportTemplates[command.template_key] !== this.access.domain(row)) badRequest("REQ_INVALID_BODY", "Template domain mismatch.");
    await this.access.context(actor, row.id, command.context);
    await this.access.context(this.access.other(row, actor), row.id, command.context);
  }
  private makeNote(actor: string, other: string, row: FrogSleepEntityRecord, command: SupportSubmission): SupportNote {
    const now = new Date();
    return { app_id: appID, id: randomId("support_note"), relationship_id: row.id, domain: this.access.domain(row),
      sender_id: actor, recipient_id: other, template_key: command.template_key, template_version: 1,
      flower: command.flower, context: command.context, created_at: now.toISOString(), expires_at: new Date(now.getTime() + 30 * 86400000).toISOString() };
  }
  private async project(actor: string, id: string) {
    const value = await this.store.note(appID, id);
    if (!value) unavailable();
    await this.access.readable(actor, value);
    const acknowledged = await this.store.acknowledged(appID, id);
    return { ...value, acknowledged, can_acknowledge: value.recipient_id === actor && !acknowledged };
  }
}
