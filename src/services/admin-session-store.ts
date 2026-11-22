import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { AdminSessionRecord } from "../shared/types.ts";
import { createOpaqueToken, sha256 } from "../shared/utils.ts";

const ADMIN_SESSION_SCOPE = "admin.sessions";
const ADMIN_SESSION_RECORD_PREFIX = "record";

export class AdminSessionStore {
  constructor(private readonly kvManager: KVManager) {}

  async create(username: string, ttlMs: number, now = new Date()): Promise<AdminSessionRecord> {
    const session = {
      id: createOpaqueToken("adm"),
      username,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    } satisfies AdminSessionRecord;

    await this.kvManager.setJson(ADMIN_SESSION_SCOPE, this.recordKey(session.id),
      { username, createdAt: session.createdAt, expiresAt: session.expiresAt }, Math.ceil(ttlMs / 1000));
    return session;
  }

  async get(sessionId: string, now = new Date()): Promise<AdminSessionRecord | undefined> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return undefined;
    }

    const session = await this.kvManager.getJson<Omit<AdminSessionRecord, "id">>(
      ADMIN_SESSION_SCOPE, this.recordKey(normalizedSessionId),
    ) ?? await this.kvManager.getJson<Omit<AdminSessionRecord, "id">>(
      ADMIN_SESSION_SCOPE, this.legacyRecordKey(normalizedSessionId),
    );

    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt) <= now) {
      await this.delete(normalizedSessionId);
      return undefined;
    }

    return { ...session, id: normalizedSessionId };
  }

  async delete(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    await this.kvManager.applyAtomic(ADMIN_SESSION_SCOPE, {
      set: [], delete: [this.recordKey(normalizedSessionId), this.legacyRecordKey(normalizedSessionId)],
    });
  }

  private recordKey(sessionId: string): string {
    return `${ADMIN_SESSION_RECORD_PREFIX}:sha256:${sha256(sessionId)}`;
  }

  private legacyRecordKey(sessionId: string): string {
    return `${ADMIN_SESSION_RECORD_PREFIX}:${sessionId}`;
  }
}
