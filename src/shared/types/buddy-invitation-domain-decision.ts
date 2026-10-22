/** Independent invitation decision and its immutable original relationship receipt. */
export interface FrogSleepBuddyInvitationDomainDecisionRecord {
  appId: string;
  invitationId: string;
  domain: "sleep" | "focus";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  version: number;
  decidedByUserId?: string;
  decidedAt?: string;
  idempotencyKeyHash?: string;
  relationshipId?: string;
  terminalReason?: string;
  createdAt: string;
  updatedAt: string;
}
