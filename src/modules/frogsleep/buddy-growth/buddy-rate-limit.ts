import { tooManyRequests } from "../../../shared/errors.ts";

type Bucket = { startedAt: number; count: number };

/**
 * Applies bounded per-actor limits to invitation and protected-access operations.
 *
 * ## Limitations (MVP scaffold — replace before general availability)
 *
 * This implementation stores buckets in an in-process `Map`. That means:
 *
 * - **Buckets reset on every server restart** — a user who trips the limit, then
 *   waits for a deploy or crash-recovery, gets a fresh allowance.
 * - **Buckets are per-process** — if the API runs behind multiple worker
 *   processes (e.g. Node cluster mode), each process tracks its own counters,
 *   multiplying the effective limit by the worker count.
 * - **Buckets are per-deployment** — horizontally-scaled replicas do not share
 *   state, so the limit becomes `limit * replica_count` in the worst case.
 *
 * For production-grade protection, replace the `Map` with a persisted counter
 * store (Redis `INCR … EXPIRE`, Postgres row per bucket, or similar) so state
 * survives restarts and is shared across replicas.
 */
export class BuddyRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  assert(scope: string, actorKey: string, limit: number, windowMs: number): void {
    const key = `${scope}:${actorKey}`;
    const now = this.now();
    const current = this.buckets.get(key);
    const bucket = !current || now - current.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (bucket.count <= limit) return;
    tooManyRequests("AUTH_RATE_LIMITED", "Buddy request rate limit reached.", {
      retry_after_seconds: Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)),
    });
  }
}

export const buddyRateLimiter = new BuddyRateLimiter();

export function limitBuddyInviteCreation(userId: string): void {
  buddyRateLimiter.assert("invite-create", userId, 30, 60 * 60 * 1000);
}

export function limitBuddyPreview(userId: string): void {
  buddyRateLimiter.assert("invite-preview", userId, 60, 60 * 1000);
}

export function limitBuddyResponse(userId: string): void {
  buddyRateLimiter.assert("invite-response", userId, 60, 60 * 1000);
}

export function limitBuddyUnauthorizedAccess(userId: string): void {
  buddyRateLimiter.assert("unauthorized-access", userId, 20, 60 * 1000);
}
