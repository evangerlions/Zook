import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyDomainRelationshipRecord, FrogSleepBuddyInvitationBundleRecord,
  FrogSleepBuddyInvitationDomainDecisionRecord } from "../../../shared/types.ts";
import { ApplicationError, conflict } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { canonicalFrogSleepBuddyParticipants } from "./buddy-domain-relationship-validation.ts";
import { assertBuddyPairNotBlocked } from "./buddy-safety.ts";
import { enqueueBuddyInvitationEvent } from "./buddy-invitation-events.ts";

type Domain = FrogSleepBuddyInvitationDomainDecisionRecord["domain"];

/** Executes new-path invitation commands against per-domain relationship facts. */
export class BuddyDomainInvitationCommandService {
  constructor(private readonly database: ApplicationDatabase) {}

  async accept(actorUserId: string, invitationId: string, domain: Domain, input: {
    expectedVersion: number; idempotencyKey: string;
  }) {
    const bundle = await this.requireBundleIdentity(invitationId, actorUserId, domain);
    const decision = await this.requireDecision(invitationId, domain);
    if (this.isReplay(decision, input.idempotencyKey)) return await this.replay(bundle, decision);
    this.assertBundleActionable(bundle);
    this.assertDecisionNotExpired(decision);
    await assertBuddyPairNotBlocked(this.database, bundle.inviterUserId, actorUserId);
    return await this.database.withFrogSleepBuddyCommandTransaction([
      { appId: FROGSLEEP_APP_ID, userId: bundle.inviterUserId, domain },
      { appId: FROGSLEEP_APP_ID, userId: actorUserId, domain },
    ], async () => await this.acceptLocked(actorUserId, invitationId, domain, input));
  }

  private async acceptLocked(actorUserId: string, invitationId: string, domain: Domain, input: {
    expectedVersion: number; idempotencyKey: string;
  }) {
    const bundle = await this.requireBundleIdentity(invitationId, actorUserId, domain);
    const decision = await this.requireDecision(invitationId, domain);
    if (this.isReplay(decision, input.idempotencyKey)) return await this.replay(bundle, decision);
    this.assertBundleActionable(bundle);
    this.assertDecisionNotExpired(decision);
    await assertBuddyPairNotBlocked(this.database, bundle.inviterUserId, actorUserId);
    if (decision.status !== "pending" || decision.version !== input.expectedVersion) {
      conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
    }
    const slots = await this.availableSlots(bundle, domain);
    const relationship = this.relationship(bundle, domain);
    await this.database.insertFrogSleepBuddyDomainRelationship(relationship);
    await this.occupySlots(slots, relationship.id);
    const accepted = await this.database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({
      appId: FROGSLEEP_APP_ID, invitationId, domain, expectedVersion: decision.version, status: "accepted",
      decidedByUserId: actorUserId, decidedAt: relationship.createdAt,
      idempotencyKeyHash: sha256(input.idempotencyKey),
      updatedAt: relationship.createdAt,
    });
    if (!accepted) conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
    await enqueueBuddyInvitationEvent(this.database, { recipientUserId: bundle.inviterUserId, invitationId,
      domain, eventType: "invitation_accepted" });
    return this.payload(accepted, relationship);
  }

  private async requireBundleIdentity(invitationId: string, actorUserId: string, domain: Domain) {
    const bundle = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, invitationId);
    if (!bundle || bundle.inviteeUserId !== actorUserId) throw unavailable();
    if (!bundle.domains.includes(domain)) throw unavailable();
    return bundle;
  }

  private assertBundleActionable(bundle: FrogSleepBuddyInvitationBundleRecord) {
    if (bundle.status !== "pending" || Date.parse(bundle.expiresAt) <= Date.now()) {
      conflict("REQ_INVALID_BODY", "Buddy invitation is expired or terminal.");
    }
  }

  private async requireDecision(invitationId: string, domain: Domain) {
    const decision = await this.database.findFrogSleepBuddyInvitationDomainDecision(FROGSLEEP_APP_ID, invitationId, domain);
    if (!decision) throw unavailable();
    return decision;
  }

  private assertDecisionNotExpired(decision: FrogSleepBuddyInvitationDomainDecisionRecord) {
    if (decision.status === "expired") conflict("REQ_INVALID_BODY", "Buddy invitation decision is expired.");
  }

  private isReplay(decision: FrogSleepBuddyInvitationDomainDecisionRecord, idempotencyKey: string) {
    return decision.status === "accepted" && decision.idempotencyKeyHash === sha256(idempotencyKey);
  }

  private async availableSlots(bundle: FrogSleepBuddyInvitationBundleRecord, domain: Domain) {
    const inviter = await this.database.findFrogSleepBuddyDomainSlot(FROGSLEEP_APP_ID, bundle.inviterUserId, domain);
    const invitee = await this.database.findFrogSleepBuddyDomainSlot(FROGSLEEP_APP_ID, bundle.inviteeUserId!, domain);
    if (!inviter || !invitee || inviter.state !== "available" || invitee.state !== "available") {
      conflict("BUDDY_DOMAIN_SLOT_OCCUPIED", "Buddy domain slot is occupied.");
    }
    return [inviter, invitee] as const;
  }

  private relationship(bundle: FrogSleepBuddyInvitationBundleRecord, domain: Domain) {
    const now = new Date().toISOString();
    const participants = canonicalFrogSleepBuddyParticipants(bundle.inviterUserId, bundle.inviteeUserId!);
    return { id: randomId("buddy_domain_relationship"), appId: FROGSLEEP_APP_ID, domain, ...participants,
      status: "active", pausedByUserIds: [], version: 1, createdAt: now, updatedAt: now } satisfies FrogSleepBuddyDomainRelationshipRecord;
  }

  private async occupySlots(slots: Awaited<ReturnType<BuddyDomainInvitationCommandService["availableSlots"]>>, relationshipId: string) {
    for (const slot of slots) {
      const updated = await this.database.compareAndUpdateFrogSleepBuddyDomainSlot({ appId: slot.appId,
        userId: slot.userId, domain: slot.domain, expectedVersion: slot.version, state: "occupied",
        relationshipId, updatedAt: new Date().toISOString() });
      if (!updated) conflict("BUDDY_DOMAIN_SLOT_OCCUPIED", "Buddy domain slot is occupied.");
    }
  }

  private async replay(bundle: FrogSleepBuddyInvitationBundleRecord, decision: FrogSleepBuddyInvitationDomainDecisionRecord) {
    const slot = await this.database.findFrogSleepBuddyDomainSlot(FROGSLEEP_APP_ID, bundle.inviteeUserId!, decision.domain);
    const relationship = slot?.relationshipId
      ? await this.database.findFrogSleepBuddyDomainRelationship(FROGSLEEP_APP_ID, slot.relationshipId) : undefined;
    if (!relationship) conflict("REQ_INVALID_BODY", "Buddy invitation decision relationship is unavailable.");
    return this.payload(decision, relationship);
  }

  private payload(decision: FrogSleepBuddyInvitationDomainDecisionRecord, relationship: FrogSleepBuddyDomainRelationshipRecord) {
    return { invitation_id: decision.invitationId, domain: decision.domain, decision_status: decision.status,
      decision_version: decision.version, relationship_id: relationship.id, relationship_status: relationship.status };
  }
}

function unavailable() {
  return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
}
