import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { tooManyRequests } from "../shared/errors.ts";
import { sha256 } from "../shared/utils.ts";

const ADMIN_LOGIN_RATE_LIMIT_SCOPE = "admin.login-rate-limits";

export class AdminLoginRateLimiter {
  private readonly windowMs: number;
  private readonly limit: number;

  constructor(private readonly kvManager: KVManager, windowMs = 15 * 60 * 1000, limit = 10) {
    this.windowMs = windowMs;
    this.limit = limit;
  }

  async consume(username: string, ipAddress: string, now = new Date()): Promise<void> {
    const key = this.buildKey(username, ipAddress);
    const currentWindow = ((await this.kvManager.getJson<number[]>(ADMIN_LOGIN_RATE_LIMIT_SCOPE, key)) ?? []).filter(
      (timestamp) => now.getTime() - timestamp < this.windowMs,
    );

    if (currentWindow.length >= this.limit) {
      tooManyRequests("ADMIN_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    currentWindow.push(now.getTime());
    await this.kvManager.setJson(
      ADMIN_LOGIN_RATE_LIMIT_SCOPE,
      key,
      currentWindow,
      Math.ceil(this.windowMs / 1000),
    );
  }

  private buildKey(username: string, ipAddress: string): string {
    const normalizedUser = username.trim().toLowerCase();
    const normalizedIp = ipAddress.trim().toLowerCase();
    return sha256(`${normalizedUser}:${normalizedIp}`);
  }
}
