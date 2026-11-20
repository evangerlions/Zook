import type { ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import type { ThirdPartyProvider } from "../identity/auth-identity-models.ts";

export type AuthPlatform = "ios" | "android" | "ohos" | "macos" | "windows" | "web";
export type ProductRegion = "CN" | "GLOBAL";

export interface ThirdPartyClient {
  clientId: string;
  serverClientId?: string;
  secretKey?: string;
  teamId?: string;
  keyId?: string;
}

export interface ThirdPartyClientSource {
  get(appId: string, platform: AuthPlatform, provider: ThirdPartyProvider): Promise<ThirdPartyClient | undefined>;
  readSecret(key: string): Promise<string | undefined>;
}

export interface ThirdPartyAttempt {
  id: string;
  appId: string;
  provider: ThirdPartyProvider;
  platform: AuthPlatform;
  region: ProductRegion;
  purpose: "login" | "identity_change";
  clientType: "app" | "web";
  clientId: string;
  audience: string;
  transport: "sdk" | "google_web" | "browser";
  nonce: string;
  state: string;
  expiresAt: string;
  userId?: string;
  changeId?: string;
  redirectUri?: string;
  codeVerifier?: string;
}

export interface VerifiedThirdPartyIdentity {
  kind: ThirdPartyProvider;
  subject: string;
  displayName?: string;
}

export interface ThirdPartyIdentityVerifier {
  verify(attempt: ThirdPartyAttempt, credential: ThirdPartyCredential, client: ThirdPartyClient): Promise<VerifiedThirdPartyIdentity>;
}

/** Product policy is independent from provider SDK and operating system code. */
export function supportsThirdParty(platform: AuthPlatform, region: ProductRegion, provider: ThirdPartyProvider): boolean {
  switch (platform) {
    case "ios": return provider === "apple" || (region === "CN" ? provider === "wechat" : provider === "google");
    case "android": return region === "CN" ? provider === "wechat" : provider === "google";
    case "ohos": return region === "CN" && provider === "wechat";
    case "macos": return provider === "apple" || (region === "GLOBAL" && provider === "google");
    case "windows": case "web": return region === "GLOBAL" && provider === "google";
  }
}
