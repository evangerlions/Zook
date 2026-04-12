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

    await this.kvManager.setJson(ADMIN_SESSION_SCOPE, this.recordKey(session.id), session);
    return session;
  }

  async get(sessionId: string, now = new Date()): Promise<AdminSessionRecord | undefined> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return undefined;
    }

    const session = await this.kvManager.getJson<AdminSessionRecord>(
      ADMIN_SESSION_SCOPE,
      this.recordKey(normalizedSessionId),
    );

    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt) <= now) {
      await this.delete(normalizedSessionId);
      return undefined;
    }

    return session;
  }

  async refresh(sessionId: string, ttlMs: number, now = new Date()): Promise<AdminSessionRecord | undefined> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return undefined;
    }

    const session = await this.get(normalizedSessionId, now);
    if (!session) {
      return undefined;
    }

    const refreshed: AdminSessionRecord = {
      ...session,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };

    await this.kvManager.setJson(ADMIN_SESSION_SCOPE, this.recordKey(normalizedSessionId), refreshed);
    return refreshed;
  }

  async delete(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return;
    }

    await this.kvManager.delete(ADMIN_SESSION_SCOPE, this.recordKey(normalizedSessionId));
  }

  private recordKey(sessionId: string): string {
    return `${ADMIN_SESSION_RECORD_PREFIX}:${sha256(sessionId)}`;
  }
}
