import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { tooManyRequests } from "../shared/errors.ts";
import { sha256 } from "../shared/utils.ts";

const SCOPE = "admin.login-rate-limits";
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

export async function consumeAdminLoginAttempt(kv: KVManager, username: string, ipAddress: string, now = Date.now()) {
  const key = sha256(JSON.stringify([username.trim().toLowerCase(), ipAddress.trim().toLowerCase()]));
  for (let attempt = 0; attempt <= LIMIT; attempt++) {
    const raw = await kv.getString(SCOPE, key);
    const recent = (JSON.parse(raw ?? "[]") as number[]).filter(timestamp => timestamp > now - WINDOW_MS);
    if (recent.length >= LIMIT) break;
    recent.push(now);
    if (await kv.applyAtomic(SCOPE, {
      compare: [{ key, value: raw ?? null }],
      set: [{ key, value: JSON.stringify(recent), ttlSeconds: WINDOW_MS / 1000 }],
    })) return;
  }
  tooManyRequests("ADMIN_RATE_LIMITED", "Request rate is too high. Please retry later.");
}
