export const identityKinds = ["email", "phone", "wechat", "google", "apple"] as const;
export type IdentityKind = typeof identityKinds[number];
export type ThirdPartyProvider = Exclude<IdentityKind, "email" | "phone">;
export type VerificationMethod = "password" | "email_code" | "sms_code";

export interface AppIdentityAccount {
  appId: string;
  userId: string;
  revision: number;
  phonePromptOffered: boolean;
}

export interface AppIdentityBinding {
  appId: string;
  kind: IdentityKind;
  subject: string;
  userId: string;
  status: "bound" | "released";
  displayName?: string;
}

export interface AccountSecuritySummary {
  revision: number;
  bindings: { kind: IdentityKind; maskedValue?: string; displayName?: string }[];
}

export interface IdentityChange {
  id: string;
  appId: string;
  userId: string;
  kind: IdentityKind;
  mode: "bind" | "replace";
  revision: number;
  currentVerified: boolean;
  expiresAt: string;
  status: "pending" | "applied";
  challenge?: {
    id: string;
    stage: "current" | "target";
    method: Exclude<VerificationMethod, "password">;
    subject: string;
    codeKey: string;
  };
}

export interface IdentityVerificationOption {
  method: VerificationMethod;
  maskedDestination?: string;
}

export function maskIdentity(value: string): string {
  const at = value.indexOf("@");
  return at >= 0 ? `${value.slice(0, 1)}***${value.slice(at)}`
    : `${value.slice(0, Math.min(5, value.length - 4))}****${value.slice(-4)}`;
}
