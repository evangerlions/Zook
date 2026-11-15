import { createHash, timingSafeEqual } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { FEISHU, type FeishuClient, type FeishuScope } from "./feishu-config.ts";

export const digestIntegrationKey = (value: string) => createHash("sha256").update(value).digest("hex");
export class IntegrationAccess {
  constructor(private readonly kv: KVManager, private readonly passwords: CommonPasswordConfigService) {}

  async authorize(request: HttpRequest, scope: FeishuScope): Promise<string> {
    await this.limit(`entry:${digestIntegrationKey(request.ipAddress ?? "unknown")}`, 120);
    const match = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/);
    if (!match) throw new ApplicationError(401, "INTEGRATION_AUTH_REQUIRED", "A dedicated integration Bearer key is required.");
    const digest = Buffer.from(digestIntegrationKey(match[1]), "hex");
    const raw = await this.passwords.getValue(FEISHU.clientsKey);
    let clients: FeishuClient[];
    try { clients = raw ? JSON.parse(raw) : []; if (!Array.isArray(clients)) throw new Error(); }
    catch { throw new ApplicationError(503, "FEISHU_UNCONFIGURED", "Integration client configuration is invalid."); }
    const client = clients.find(item => /^[a-f0-9]{64}$/.test(item.digest) && timingSafeEqual(digest, Buffer.from(item.digest, "hex")));
    if (!client) throw new ApplicationError(401, "INTEGRATION_AUTH_REQUIRED", "Integration key is invalid or revoked.");
    if (!client.scopes.includes(scope)) throw new ApplicationError(403, "INTEGRATION_SCOPE_DENIED", "Integration key does not grant this operation.");
    await this.limit(`${client.id}:${scope}`, scope === "bookkeeping:read" ? 60 : 10);
    return client.id;
  }

  private async limit(key: string, max: number): Promise<void> {
    const bucket = `${key}:${Math.floor(Date.now() / 60_000)}`;
    await this.kv.incrementCounters("feishu-rate", bucket, { requests: 1 }, 120);
    if ((await this.kv.getCounters("feishu-rate", bucket)).requests > max) {
      throw new ApplicationError(429, "INTEGRATION_RATE_LIMITED", "Integration request rate exceeded.");
    }
  }
}
