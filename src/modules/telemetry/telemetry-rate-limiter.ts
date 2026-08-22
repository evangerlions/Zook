interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

export class TelemetryRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private nextExpiryAt = Number.POSITIVE_INFINITY;

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxTrackedKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing && now - existing.windowStartedAt < this.windowMs) {
      existing.count += 1;
      return existing.count <= this.limit;
    }

    if (existing) {
      this.entries.delete(key);
    }
    if (now >= this.nextExpiryAt) {
      this.pruneExpired(now);
    }
    if (this.entries.size >= this.maxTrackedKeys) {
      return false;
    }

    this.entries.set(key, { count: 1, windowStartedAt: now });
    this.nextExpiryAt = Math.min(this.nextExpiryAt, now + this.windowMs);
    return true;
  }

  private pruneExpired(now: number): void {
    let nextExpiryAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= this.windowMs) {
        this.entries.delete(key);
      } else {
        nextExpiryAt = Math.min(
          nextExpiryAt,
          entry.windowStartedAt + this.windowMs,
        );
      }
    }
    this.nextExpiryAt = nextExpiryAt;
  }
}
