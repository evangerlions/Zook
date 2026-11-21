import type { ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { ThirdPartyAttempt, ThirdPartyClient, ThirdPartyClientSource, ThirdPartyIdentityVerifier } from "./third-party-models.ts";

export class WechatIdentityVerifier implements ThirdPartyIdentityVerifier {
  constructor(private readonly clients: ThirdPartyClientSource, private readonly fetcher: typeof fetch = fetch) {}
  async verify(attempt: ThirdPartyAttempt, credential: ThirdPartyCredential, client: ThirdPartyClient) {
    if (credential.type !== "authorization_code" || credential.state !== attempt.state)
      badRequest("AUTH_PROVIDER_PROOF_INVALID", "WeChat authorization state is invalid.");
    const secret = client.secretKey && await this.clients.readSecret(client.secretKey);
    if (!secret) badRequest("AUTH_PROVIDER_UNAVAILABLE", "WeChat sign-in is not configured.");
    try {
      const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
      url.search = new URLSearchParams({ appid: client.clientId, secret, code: credential.code, grant_type: "authorization_code" }).toString();
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(15_000) });
      const result = await response.json() as { errcode?: number; openid?: string; unionid?: string };
      if (!response.ok || result.errcode || !result.openid) badRequest("AUTH_PROVIDER_PROOF_INVALID", "WeChat authorization could not be verified.");
      // UnionID is scoped to one WeChat Open Platform account. App-scoped OpenID
      // remains namespaced by registered AppID when no UnionID is supplied.
      return { kind: "wechat" as const, subject: result.unionid ? `union:${result.unionid}` : `openid:${client.clientId}:${result.openid}` };
    } catch { badRequest("AUTH_PROVIDER_PROOF_INVALID", "WeChat authorization could not be verified."); }
  }
}
