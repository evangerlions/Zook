import type { AuthenticatedUserProfile } from "../../shared/types.ts";

/** Response capability negotiation, independent from platform/version and from
 * the authoritative identity store. Older SDKs decode identity enums strictly.
 */
export function serializeUserProfile(
  profile: AuthenticatedUserProfile,
  identitySchemaVersion?: string,
): AuthenticatedUserProfile {
  const version = identitySchemaVersion?.trim() ?? "";
  if (/^[1-9]\d*$/.test(version) && Number.isSafeInteger(Number(version)) && Number(version) >= 2)
    return profile;
  if (!profile.accountSecurity) return profile;
  return { ...profile, accountSecurity: { ...profile.accountSecurity,
    bindings: profile.accountSecurity.bindings.filter(binding => binding.kind !== "huawei"),
  } };
}
