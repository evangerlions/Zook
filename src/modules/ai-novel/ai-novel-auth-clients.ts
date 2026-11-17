import type { AuthPlatform, ThirdPartyClient, ThirdPartyClientSource } from "../auth/third-party/third-party-models.ts";
import type { ThirdPartyProvider } from "../auth/identity/auth-identity-models.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";

/** Public registered client identifiers belong to the product, not deployment env.
 * Populate with registered provider IDs; an absent registration stays unavailable.
 * Private material is resolved exclusively through existing Server -> Passwords.
 */
const registeredClients: Partial<Record<AuthPlatform, Partial<Record<ThirdPartyProvider, ThirdPartyClient>>>> = {
  ios: {}, // wechat clientId + secretKey; google clientId/serverClientId; apple clientId/teamId/keyId/secretKey
  android: {}, // wechat and Google registrations; direct/official CN policy remains product-owned
  ohos: {}, // WeChat only
  macos: {}, // Apple and Google
  windows: {}, // Google desktop clientId, optional secretKey
  web: {}, // Google web clientId
};

export class AiNovelAuthClientSource implements ThirdPartyClientSource {
  constructor(private readonly secrets: CommonPasswordConfigService,
    private readonly clients = registeredClients) {}
  async get(appId: string, platform: AuthPlatform, provider: ThirdPartyProvider): Promise<ThirdPartyClient | undefined> {
    return appId === "ai_novel" ? this.clients[platform]?.[provider] : undefined;
  }
  readSecret(key: string) { return this.secrets.getValue(key); }
}
