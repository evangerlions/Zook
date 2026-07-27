import { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { tooManyRequests } from "../../../shared/errors.ts";

type Bucket = { startedAt: number; count: number };

const KV_SCOPE = "frogsleep.buddy-rate-limits";

/**
 * Applies bounded per-actor limits to invitation and protected-access operations.
 *
 * Backed by `KVManager` so state survives restarts and is shared across replicas.
 * Each bucket is stored as JSON with TTL = `windowMs` so unused buckets auto-expire.
 */
export class BuddyRateLimiter {
  constructor(
    private readonly kvManager: KVManager,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async assert(scope: string, actorKey: string, limit: number, windowMs: number): Promise<void> {
    if (!this.kvManager || typeof this.kvManager.getJson !== "function") return;
    const key = `${scope}:${actorKey}`;
    const now = this.now();
    const current = await this.kvManager.getJson<Bucket>(KV_SCOPE, key);
    const bucket: Bucket = !current || now - current.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : current;
    bucket.count += 1;
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    await this.kvManager.setJson(KV_SCOPE, key, bucket, ttlSeconds);
    if (bucket.count <= limit) return;
    tooManyRequests("AUTH_RATE_LIMITED", "Buddy request rate limit reached.", {
      retry_after_seconds: Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)),
    });
  }
}

export async function limitBuddyInviteCreation(kvManager: KVManager, userId: string): Promise<void> {
  await new BuddyRateLimiter(kvManager).assert("invite-create", userId, 30, 60 * 60 * 1000);
}

export async function limitBuddyPreview(kvManager: KVManager, userId: string): Promise<void> {
  await new BuddyRateLimiter(kvManager).assert("invite-preview", userId, 60, 60 * 1000);
}

export async function limitBuddyResponse(kvManager: KVManager, userId: string): Promise<void> {
  await new BuddyRateLimiter(kvManager).assert("invite-response", userId, 60, 60 * 1000);
}

export async function limitBuddyUnauthorizedAccess(kvManager: KVManager, userId: string): Promise<void> {
  await new BuddyRateLimiter(kvManager).assert("unauthorized-access", userId, 20, 60 * 1000);
}
