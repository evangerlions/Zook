import type { AuthPlatform, ThirdPartyClient, ThirdPartyClientSource } from "../auth/third-party/third-party-models.ts";
import type { ThirdPartyProvider } from "../auth/identity/auth-identity-models.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";

const wechatClient: ThirdPartyClient = {
  clientId: "wx55ada0a7ff21dd96",
  secretKey: "ainovel.auth.wechat.app-secret",
};

/** Public registered client identifiers belong to the product, not deployment env.
 * Populate with registered provider IDs; an absent registration stays unavailable.
 * Private material is resolved exclusively through existing Server -> Passwords.
 */
const registeredClients: Partial<Record<AuthPlatform, Partial<Record<ThirdPartyProvider, ThirdPartyClient>>>> = {
  ios: { wechat: wechatClient },
  android: { wechat: wechatClient },
  ohos: {
    wechat: wechatClient,
    huawei: {
      clientId: "6917615743794008142",
      secretKey: "ainovel.auth.huawei.client-secret",
    },
  },
  macos: {
    google: {
      clientId: "325350098225-rc12ep8hgl05ivisjb9h32r7tg3dkuj4.apps.googleusercontent.com",
      serverClientId: "325350098225-b6bcqn6ncquonrt9bbs4jcun3jvsekdj.apps.googleusercontent.com",
    },
    apple: {
      clientId: "com.zhizhuokai.orangewrite",
      teamId: "LTN9Y4UXN3",
      keyId: "GQ6BC5XTN3",
      secretKey: "ainovel.auth.apple.private-key",
    },
  },
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
