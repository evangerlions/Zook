import { parseIsoTimestamp } from "../frogsleep-validation.ts";
import { createHash } from "node:crypto";
import { ApplicationError, badRequest, conflict } from "../../../shared/errors.ts";
import type { PersonalResourceKind, PersonalSyncRepository, PersonalSyncTransaction, PersonalVersion } from "./personal-sync.types.ts";
import { decodePersonalCursor, encodePersonalCursor, type PersonalCursor } from "./personal-sync-cursor.ts";

export interface PersonalWriteOptions { epoch?: string; operationKey?: string; expectedRevision?: number }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a===b ? 0 : a<b ? -1 : 1).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(stable(value)).digest("hex"); }
export function personalSyncCapabilities(env: NodeJS.ProcessEnv = process.env) {
  return { read: env.FROGSLEEP_PERSONAL_SYNC_READ_ENABLED !== "false", write: env.FROGSLEEP_PERSONAL_SYNC_WRITE_ENABLED !== "false" };
}
/** Owns private resource revisions, tombstones, idempotent commands and fixed-boundary recovery. */
export class PersonalSyncService {
  constructor(private readonly repository: PersonalSyncRepository) {}
  async state(user: string) {
    this.assertEnabled("read");
    return this.repository.run(user, async tx => ({ sync_epoch: tx.state.epoch, sequence: tx.state.sequence, capabilities: personalSyncCapabilities() }));
  }
  async get(user: string, kind: PersonalResourceKind, id: string) {
    this.assertEnabled("read");
    return this.repository.run(user, async tx => {
      const record = await tx.current(kind, id);
      if (!record || record.deleted) throw new ApplicationError(404, "FROGSLEEP_SYNC_RESOURCE_NOT_FOUND", "Resource was not found.");
      return { ...record, sync_epoch: tx.state.epoch };
    });
  }
  async write(user: string, kind: PersonalResourceKind, id: string, data: Record<string, unknown>, deleted: boolean, options: PersonalWriteOptions = {}) {
    this.assertEnabled("write");
    if (!id.trim() || id.length > 200 || id.includes("\u0000")) badRequest("REQ_INVALID_BODY", "A stable resource ID is required (max 200 characters).");
    return this.repository.run(user, async tx => this.writeLocked(tx, kind, id, data, deleted, options));
  }
  private async writeLocked(tx: PersonalSyncTransaction, kind: PersonalResourceKind, id: string, data: Record<string, unknown>, deleted: boolean, options: PersonalWriteOptions) {
    this.assertEpoch(tx, options.epoch);
    const previous = await tx.current(kind, id);
    if (previous?.deleted && !deleted) throw new ApplicationError(410, "FROGSLEEP_SYNC_RESOURCE_DELETED", "A deleted resource cannot be recreated by an old upload.");
    const hash = digest([kind,id,deleted,data,options.expectedRevision ?? null]);
    const key = options.operationKey ?? `legacy:${hash}`;
    if (!key.trim() || key.length > 200) badRequest("REQ_INVALID_HEADER", "Invalid idempotency key.");
    const receipt = await tx.receipt(key);
    if (receipt) {
      if (receipt.digest !== hash) conflict("FROGSLEEP_SYNC_IDEMPOTENCY_CONFLICT", "Operation key was reused with different content.");
      return { ...receipt.result, sync_epoch: tx.state.epoch };
    }
    if (previous && options.expectedRevision !== undefined && options.expectedRevision !== previous.revision) conflict("FROGSLEEP_SYNC_REVISION_CONFLICT", "If-Match must match the current revision.");
    if (previous && (previous.deleted && deleted || !deleted && stable(previous.data) === stable(data))) {
      await tx.saveReceipt(key, hash, previous);
      return { ...previous, sync_epoch: tx.state.epoch };
    }
    if (previous && options.expectedRevision !== previous.revision) conflict("FROGSLEEP_SYNC_REVISION_CONFLICT", "If-Match must match the current revision.");
    if (!previous && options.expectedRevision !== undefined && options.expectedRevision !== 0) conflict("FROGSLEEP_SYNC_REVISION_CONFLICT", "Resource does not have that revision.");
    if (!previous && deleted) throw new ApplicationError(404, "FROGSLEEP_SYNC_RESOURCE_NOT_FOUND", "Resource was not found.");
    return this.commit(tx, kind, id, data, deleted, previous, key, hash);
  }
  private async commit(tx: PersonalSyncTransaction, kind: PersonalResourceKind, id: string, data: Record<string, unknown>, deleted: boolean, previous: PersonalVersion | undefined, key: string, hash: string) {
    const now = new Date().toISOString();
    const version: PersonalVersion = { kind, id, data: deleted ? {} : data, deleted, revision: (previous?.revision ?? 0) + 1, sequence: tx.state.sequence + 1, created_at: previous?.created_at ?? now, updated_at: now };
    await tx.commit(version, key, hash);
    return { ...version, sync_epoch: tx.state.epoch };
  }
  async page(user: string, mode: "restore" | "changes", limit: number, token?: string, kind?: PersonalResourceKind) {
    this.assertEnabled("read");
    return this.repository.run(user, async tx => {
      const cursor: PersonalCursor = token ? decodePersonalCursor(token, user, mode, tx.state)
        : { user, epoch: tx.state.epoch, mode, boundary: tx.state.sequence, after: 0, expires: Date.now() + 7 * 86400000, kind };
      if (cursor.kind !== kind) conflict("FROGSLEEP_SYNC_CURSOR_INVALID", "Cursor belongs to a different resource query.");
      const boundary = cursor.boundary || tx.state.sequence;
      const rows = await tx.page(mode, boundary, cursor.after, limit + 1, kind);
      const items = rows.slice(0, limit), hasMore = rows.length > limit;
      const after = hasMore ? items.at(-1)!.sequence : boundary;
      const next = encodePersonalCursor({ ...cursor, after, boundary: mode === "changes" && !hasMore ? 0 : boundary }, tx.state);
      const checkpoint = encodePersonalCursor({ ...cursor, mode: "changes", after: boundary, boundary: 0, kind: undefined }, tx.state);
      return { items, sync_epoch: tx.state.epoch, boundary, changes_cursor: mode === "restore" ? checkpoint : next,
        pagination: { limit, has_more: hasMore, next_cursor: hasMore ? next : null } };
    });
  }
  async browse(user: string, limit: number, token?: string, since?: string) {
    this.assertEnabled("read");
    const lowerBound = since === undefined ? undefined : parseIsoTimestamp(since, "since");
    return this.repository.run(user, async tx => {
      const cursor: PersonalCursor = token ? decodePersonalCursor(token,user,"browse",tx.state)
        : { user,epoch:tx.state.epoch,mode:"browse",boundary:tx.state.sequence,after:0,expires:Date.now()+7*86400000,since:lowerBound };
      if (cursor.since !== lowerBound) conflict("FROGSLEEP_SYNC_CURSOR_INVALID", "Cursor belongs to a different report query.");
      const rows=await tx.browse(cursor.boundary,limit+1,cursor.reportAfter,lowerBound),items=rows.slice(0,limit),hasMore=rows.length>limit;
      const last=items.at(-1),next=hasMore ? encodePersonalCursor({...cursor,reportAfter:{time:String(last!.data.recorded_at ?? ''),id:last!.id}},tx.state) : null;
      return {items,sync_epoch:tx.state.epoch,boundary:cursor.boundary,pagination:{limit,has_more:hasMore,next_cursor:next}};
    });
  }
  private assertEpoch(tx: PersonalSyncTransaction, epoch?: string) {
    if (epoch !== tx.state.epoch && (epoch !== undefined || !tx.state.legacyAllowed)) conflict("FROGSLEEP_SYNC_EPOCH_MISMATCH", "Restore the current account epoch before uploading.");
  }
  private assertEnabled(operation: "read" | "write") {
    if (!personalSyncCapabilities()[operation]) throw new ApplicationError(503, "FROGSLEEP_SYNC_DISABLED", "Personal sync is temporarily unavailable.");
  }
}
