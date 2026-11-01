import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { RefreshTokenRecord } from "../shared/types.ts";
import { sha256 } from "../shared/utils.ts";
import type { KVAtomicChange } from "../infrastructure/kv/kv-atomic.ts";

const REFRESH_TOKEN_SCOPE = "auth.refresh-tokens";
const APP_INDEX_PREFIX = "app";
const USER_APP_INDEX_PREFIX = "user-app";
const RECORD_PREFIX = "record";
const HASH_PREFIX = "hash";
const ROTATION_PREFIX = "rotation";

export class RefreshTokenStore {
  constructor(private readonly kvManager: KVManager) {}

  async create(record: RefreshTokenRecord): Promise<void> {
    await this.kvManager.applyAtomic(REFRESH_TOKEN_SCOPE, this.creationChange(record));
  }

  async rotate(previous: RefreshTokenRecord, next: RefreshTokenRecord, now = new Date()): Promise<boolean> {
    const change = this.creationChange(next);
    change.compare = [{ key: this.buildRecordKey(previous.id), value: JSON.stringify(previous) }];
    change.set.push({ key: this.buildRecordKey(previous.id), value: JSON.stringify({
      ...previous, revokedAt: now.toISOString(), replacedBy: next.id,
    }) });
    return await this.kvManager.applyAtomic(REFRESH_TOKEN_SCOPE, change);
  }

  private creationChange(record: RefreshTokenRecord): KVAtomicChange {
    return {
      set: [
        { key: this.buildRecordKey(record.id), value: JSON.stringify(record) },
        { key: this.buildHashKey(record.tokenHash), value: record.id },
      ],
      append: [
        { key: this.buildAppIndexKey(record.appId), value: record.id },
        { key: this.buildUserAppIndexKey(record.appId, record.userId), value: record.id },
      ],
    };
  }

  async getByRawToken(rawToken: string): Promise<RefreshTokenRecord | undefined> {
    return this.getByTokenHash(sha256(rawToken));
  }

  async getByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    const recordId = await this.kvManager.getString(REFRESH_TOKEN_SCOPE, this.buildHashKey(tokenHash));
    if (!recordId) {
      return undefined;
    }

    return this.getById(recordId);
  }

  async update(record: RefreshTokenRecord): Promise<void> {
    await this.kvManager.setJson(REFRESH_TOKEN_SCOPE, this.buildRecordKey(record.id), record);
  }

  async claimRotation(tokenHash: string, expiresAt: string, now = new Date()): Promise<boolean> {
    const ttlSeconds = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1_000));
    return await this.kvManager.setStringIfAbsent(REFRESH_TOKEN_SCOPE,
      `${ROTATION_PREFIX}:${tokenHash}`, now.toISOString(), ttlSeconds);
  }

  async listByUserAndApp(appId: string, userId: string): Promise<RefreshTokenRecord[]> {
    const recordIds = await this.readIndexIds(this.buildUserAppIndexKey(appId, userId));
    return this.loadRecords(recordIds);
  }

  async revokeAllByUserAndApp(appId: string, userId: string, revokedAt: string): Promise<number> {
    const records = await this.listByUserAndApp(appId, userId);
    let revoked = 0;

    for (const record of records) {
      if (record.revokedAt) {
        continue;
      }

      record.revokedAt = revokedAt;
      await this.update(record);
      revoked += 1;
    }

    return revoked;
  }

  async deleteByApp(appId: string): Promise<void> {
    const recordIds = await this.readIndexIds(this.buildAppIndexKey(appId));
    const records = await this.loadRecords(recordIds);

    for (const record of records) {
      await this.kvManager.delete(REFRESH_TOKEN_SCOPE, this.buildRecordKey(record.id));
      await this.kvManager.delete(REFRESH_TOKEN_SCOPE, this.buildHashKey(record.tokenHash));
      await this.removeIndexId(this.buildUserAppIndexKey(record.appId, record.userId), record.id);
    }

    await this.kvManager.delete(REFRESH_TOKEN_SCOPE, this.buildAppIndexKey(appId));
  }

  private async getById(recordId: string): Promise<RefreshTokenRecord | undefined> {
    return this.kvManager.getJson<RefreshTokenRecord>(
      REFRESH_TOKEN_SCOPE,
      this.buildRecordKey(recordId),
    );
  }

  private async removeIndexId(indexKey: string, recordId: string): Promise<void> {
    const ids = await this.readIndexIds(indexKey);
    const filtered = ids.filter((value) => value !== recordId);
    if (filtered.length === 0) {
      await this.kvManager.delete(REFRESH_TOKEN_SCOPE, indexKey);
      return;
    }

    await this.kvManager.setJson(REFRESH_TOKEN_SCOPE, indexKey, filtered);
  }

  private async readIndexIds(indexKey: string): Promise<string[]> {
    const ids = await this.kvManager.getJson<string[]>(REFRESH_TOKEN_SCOPE, indexKey);
    return Array.isArray(ids) ? ids.filter((item) => typeof item === "string" && item) : [];
  }

  private async loadRecords(recordIds: string[]): Promise<RefreshTokenRecord[]> {
    const records = await Promise.all(recordIds.map((recordId) => this.getById(recordId)));
    return records.filter((record): record is RefreshTokenRecord => Boolean(record));
  }

  private buildAppIndexKey(appId: string): string {
    return `${APP_INDEX_PREFIX}:${appId}`;
  }

  private buildUserAppIndexKey(appId: string, userId: string): string {
    return `${USER_APP_INDEX_PREFIX}:${appId}:${userId}`;
  }

  private buildRecordKey(recordId: string): string {
    return `${RECORD_PREFIX}:${recordId}`;
  }

  private buildHashKey(tokenHash: string): string {
    return `${HASH_PREFIX}:${tokenHash}`;
  }
}
