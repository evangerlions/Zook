import { parsePhoneNumberFromString } from "libphonenumber-js";

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
  if (at >= 0) return `${value.slice(0, 1)}***${value.slice(at)}`;
  if (!/^\+\d+$/.test(value)) return "****";

  const phone = parsePhoneNumberFromString(value, { extract: false });
  if (!phone) return "****";

  const countryCode = `+${phone.countryCallingCode}`;
  const local = value.slice(countryCode.length);
  if (local.length < 8) {
    return `${countryCode} ${"*".repeat(Math.max(0, local.length - 4))}${local.slice(-4)}`;
  }

  return `${countryCode} ${local.slice(0, 3)}${"*".repeat(local.length - 7)}${local.slice(-4)}`;
}
