import { createHash } from "node:crypto";
import { ApplicationError } from "../../shared/errors.ts";
import type { BodyLogGroupStore } from "../../infrastructure/bodylog-store-ports.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import { GROUP_INVITATION_EXPIRY_DAYS } from "./bodylog-group.types.ts";

/** Codes are aliases for high-entropy, recipient-bound invitations, never public grants. */
export function groupInvitationCode(token: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...createHash("sha256").update(token).digest().subarray(0, 6)]
    .map(byte => alphabet[byte & 31]).join("");
}

export function groupInvitationExpiresAt(invitedAt: string): string {
  return new Date(Date.parse(invitedAt) + GROUP_INVITATION_EXPIRY_DAYS * 86400000).toISOString();
}

/** Search only the authenticated recipient's records; ambiguous aliases fail closed. */
export async function resolveGroupCode(store: BodyLogGroupStore, userId: string, input: string) {
  if (typeof input !== "string" || !/^[A-HJ-NP-Z2-9]{6}$/.test(input.trim().toUpperCase())) {
    throw new ApplicationError(400, "GROUP_INVITE_CODE_INVALID", "Enter a valid six-character invitation code.");
  }
  const invitations = await store.listGroupInvitations(BODYLOG_APP_ID, userId);
  if (invitations.length > 1000) throw new ApplicationError(429, "GROUP_INVITATION_LIMIT", "Too many invitations. Use the addressed invitation link.");
  const matches = invitations.filter(member => member.invitationToken && groupInvitationCode(member.invitationToken) === input.trim().toUpperCase());
  if (matches.length !== 1) throw new ApplicationError(404, "GROUP_INVITE_NOT_FOUND", "Invitation not found for this account.");
  const member = matches[0]!;
  const group = await store.findCheckInGroup(member.groupId);
  if (!group || group.appId !== BODYLOG_APP_ID || group.status !== "active") {
    throw new ApplicationError(404, "GROUP_INVITE_NOT_FOUND", "Invitation not found for this account.");
  }
  if (!Number.isFinite(Date.parse(member.joinedAt)) || Date.now() - Date.parse(member.joinedAt) >= GROUP_INVITATION_EXPIRY_DAYS * 86400000) {
    throw new ApplicationError(410, "GROUP_INVITE_EXPIRED", "Invitation has expired.");
  }
  return { member, group, expiresAt: groupInvitationExpiresAt(member.joinedAt) };
}
