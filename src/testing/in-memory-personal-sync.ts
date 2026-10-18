import { backfillMemoryPersonalAccount } from "./in-memory-personal-backfill.ts";
import { randomUUID } from "node:crypto";
import type { PersonalSyncRepository, PersonalSyncState, PersonalSyncTransaction, PersonalVersion, PersonalReceipt } from "../modules/frogsleep/personal-sync/personal-sync.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { InMemoryDatabase } from "./in-memory-database.ts";

/** Transactional in-memory adapter with rollback and epoch invalidation matching the SQL protocol. */
export class InMemoryPersonalSyncRepository implements PersonalSyncRepository {
  private readonly accounts = new Map<string, { state: PersonalSyncState; versions: PersonalVersion[]; receipts: Map<string, PersonalReceipt> }>();
  constructor(private readonly db: InMemoryDatabase) {}
  metadata() {
    for (const membership of this.db.appUsers.filter(m => m.appId === "frogsleep" && m.status === "ACTIVE")) {
      if (!this.accounts.has(membership.userId)) this.accounts.set(membership.userId, backfillMemoryPersonalAccount(this.db.frogSleepEntities, membership.userId));
    }
    return [...this.accounts.entries()].flatMap(([user, a]) => [...new Map(a.versions.filter(v => v.kind === "sleep_report").map(v => [v.id,v])).values()].map(v => ({ id: v.id, user_id: user, status: v.deleted ? "deleted" : "active", version: v.revision, domain: "sleep_report", updated_at: v.updated_at })));
  }
  invalidate(userId: string) { this.accounts.set(userId, { state: { epoch: randomUUID(), cursorSecret: randomUUID(), sequence: 0, legacyAllowed: false, deleted: true }, versions: [], receipts: new Map() }); }
  async run<T>(userId: string, operation: (tx: PersonalSyncTransaction) => Promise<T>): Promise<T> {
    return this.db.withExclusiveSession(async () => {
      if (this.db.findAppUser("frogsleep", userId)?.status !== "ACTIVE") throw new ApplicationError(403, "APP_MEMBERSHIP_REQUIRED", "An active Sleep account is required.");
      const existing = this.accounts.get(userId) ?? backfillMemoryPersonalAccount(this.db.frogSleepEntities, userId);
      const account = structuredClone(existing);
      account.state.deleted = false;
      const tx: PersonalSyncTransaction = {
        state: account.state,
        async current(kind, id) { return account.versions.findLast(v => v.kind === kind && v.id === id); },
        async receipt(key) { return account.receipts.get(key); },
        async saveReceipt(key, digest, result) { account.receipts.set(key, { digest, result: structuredClone(result) }); },
        async commit(version, key, digest) { account.versions.push(structuredClone(version)); account.receipts.set(key, { digest, result: structuredClone(version) }); account.state.sequence = version.sequence; },
        async browse(boundary, limit, after) {
          const latest=new Map(account.versions.filter(v=>v.kind==='sleep_report' && v.sequence<=boundary).map(v=>[v.id,v]));
          return [...latest.values()].filter(v=>!v.deleted && (!after || String(v.data.recorded_at ?? '')<after.time || String(v.data.recorded_at ?? '')===after.time && Buffer.compare(Buffer.from(v.id),Buffer.from(after.id))<0))
            .sort((a,b)=>String(b.data.recorded_at ?? '').localeCompare(String(a.data.recorded_at ?? '')) || Buffer.compare(Buffer.from(b.id),Buffer.from(a.id))).slice(0,limit);
        },
        async page(mode, boundary, after, limit, kind) {
          const versions = account.versions.filter(v => v.sequence <= boundary);
          const latest = new Map(versions.map(v => [JSON.stringify([v.kind,v.id]), v]));
          return (mode === "restore" ? [...latest.values()] : versions).filter(v => v.sequence > after && (!kind || v.kind === kind)).sort((a,b) => a.sequence-b.sequence).slice(0, limit);
        },
      };
      const result = await operation(tx);
      this.accounts.set(userId, account);
      return structuredClone(result);
    });
  }
}
