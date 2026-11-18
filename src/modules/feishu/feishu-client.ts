import { createHash } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { FEISHU } from "./feishu-config.ts";

export class FeishuApiError extends Error {
  constructor(public readonly definite: boolean, public readonly upstreamCode?: number) {
    super(definite ? `Feishu rejected the request (${upstreamCode ?? "HTTP"}).` : "Feishu result is unknown; do not resend with a new idempotency key.");
  }
}
interface CachedToken { token: string; validUntil: number; }

export class FeishuClient {
  constructor(private readonly kv: KVManager, private readonly passwords: CommonPasswordConfigService,
    private readonly fetcher: typeof fetch = fetch) {}

  async ready(): Promise<boolean> { return Boolean(await this.passwords.getValue(FEISHU.secretKey)); }

  async token(): Promise<string> {
    const secret = await this.passwords.getValue(FEISHU.secretKey);
    if (!secret) throw new ApplicationError(503, "FEISHU_UNCONFIGURED", "Feishu app credential is not configured.");
    const key = createHash("sha256").update(FEISHU.appId + secret).digest("hex");
    // The credential fingerprint makes rotation invalidate the old token immediately.
    for (let attempt = 0; attempt < 60; attempt++) {
      const cached = await this.kv.getJson<CachedToken>("feishu-token", key);
      if (cached && cached.validUntil > Date.now()) return cached.token;
      const owner = crypto.randomUUID();
      if (!await this.kv.setStringIfAbsent("feishu-token-lock", key, owner, 20)) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      try {
        const response = await this.fetcher("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_id: FEISHU.appId, app_secret: secret }),
          redirect: "error", signal: AbortSignal.timeout(10_000),
        });
        const body = await response.json();
        if (!response.ok || body.code !== 0 || typeof body.tenant_access_token !== "string" || !(body.expire > 120)) {
          throw new ApplicationError(502, "FEISHU_UNAVAILABLE", "Feishu app authentication failed; check app credentials and permissions.");
        }
        const lifetime = body.expire - 120;
        await this.kv.setJson("feishu-token", key, { token: body.tenant_access_token, validUntil: Date.now() + lifetime * 1000 }, lifetime);
        return body.tenant_access_token;
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(502, "FEISHU_UNAVAILABLE", "Feishu app authentication is unavailable.");
      } finally {
        await this.kv.applyAtomic("feishu-token-lock", { compare: [{ key, value: owner }], set: [{ key, value: "released", ttlSeconds: 1 }] });
      }
    }
    throw new ApplicationError(503, "FEISHU_UNAVAILABLE", "Feishu app authentication is busy; retry later.");
  }

  async request<T = Record<string, any>>(path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    try {
      const response = await this.fetcher(`https://open.feishu.cn/open-apis/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || result.code !== 0) throw new FeishuApiError(response.status < 500 && typeof result.code === "number" && result.code !== 0, typeof result.code === "number" ? result.code : response.status);
      return result.data as T;
    } catch (error) {
      if (error instanceof FeishuApiError) throw error;
      throw new FeishuApiError(false);
    }
  }

  async send(text: string, operationId: string): Promise<{ messageId: string }> {
    const data = await this.request("im/v1/messages?receive_id_type=open_id", {
      receive_id: FEISHU.recipient, msg_type: "text", content: JSON.stringify({ text }),
      uuid: createHash("sha256").update(operationId).digest("hex").slice(0, 32),
    });
    if (typeof data.message_id !== "string") throw new FeishuApiError(false);
    return { messageId: data.message_id };
  }
}
