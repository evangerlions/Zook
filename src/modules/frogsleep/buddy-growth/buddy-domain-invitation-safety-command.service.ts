import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationBundleRecord, FrogSleepBuddyInvitationDomainDecisionRecord } from "../../../shared/types.ts";
import { ApplicationError, conflict } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { enqueueBuddyInvitationEvent } from "./buddy-invitation-events.ts";

type Domain = FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
type SafetyAction = "decline" | "cancel";

/** Executes capability-independent decline and cancel commands for a single buddy domain decision. */
export class BuddyDomainInvitationSafetyCommandService {
  constructor(private readonly database: ApplicationDatabase) {}

  async execute(actorUserId: string, invitationId: string, domain: Domain, action: SafetyAction, input: {
    expectedVersion: number; idempotencyKey: string;
  }) {
    const bundle = await this.requireBundleIdentity(invitationId, actorUserId, domain, action);
    const decision = await this.requireDecision(invitationId, domain);
    if (this.isReplay(decision, action, input.idempotencyKey)) {
      this.assertReplayVersion(decision, input.expectedVersion);
      return this.payload(decision);
    }
    this.assertActionable(bundle, decision, input.expectedVersion);
    return await this.database.withFrogSleepBuddyCommandTransaction(this.slotKeys(bundle, domain), async () =>
      await this.executeLocked(actorUserId, invitationId, domain, action, input));
  }

  private async executeLocked(actorUserId: string, invitationId: string, domain: Domain, action: SafetyAction, input: {
    expectedVersion: number; idempotencyKey: string;
  }) {
    const bundle = await this.requireBundleIdentity(invitationId, actorUserId, domain, action);
    const decision = await this.requireDecision(invitationId, domain);
    if (this.isReplay(decision, action, input.idempotencyKey)) {
      this.assertReplayVersion(decision, input.expectedVersion);
      return this.payload(decision);
    }
    this.assertActionable(bundle, decision, input.expectedVersion);
    const now = new Date().toISOString();
    const updated = await this.database.compareAndUpdateFrogSleepBuddyInvitationDomainDecision({
      appId: FROGSLEEP_APP_ID, invitationId, domain, expectedVersion: decision.version,
      status: action === "decline" ? "declined" : "cancelled", decidedByUserId: actorUserId,
      decidedAt: now, idempotencyKeyHash: sha256(input.idempotencyKey),
      terminalReason: action === "decline" ? "declined_by_invitee" : "cancelled_by_inviter", updatedAt: now,
    });
    if (!updated) conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
    await enqueueBuddyInvitationEvent(this.database, { invitationId, domain,
      recipientUserId: action === "decline" ? bundle.inviterUserId : bundle.inviteeUserId,
      eventType: action === "decline" ? "invitation_declined" : "invitation_cancelled" });
    return this.payload(updated);
  }

  private async requireBundleIdentity(invitationId: string, actorUserId: string, domain: Domain, action: SafetyAction) {
    const bundle = await this.database.findFrogSleepBuddyInvitationBundle(FROGSLEEP_APP_ID, invitationId);
    const expectedActor = action === "decline" ? bundle?.inviteeUserId : bundle?.inviterUserId;
    if (!bundle || expectedActor !== actorUserId || !bundle.inviteeUserId || !bundle.domains.includes(domain)) throw unavailable();
    return bundle;
  }

  private async requireDecision(invitationId: string, domain: Domain) {
    const decision = await this.database.findFrogSleepBuddyInvitationDomainDecision(FROGSLEEP_APP_ID, invitationId, domain);
    if (!decision) throw unavailable();
    return decision;
  }

  private assertActionable(bundle: FrogSleepBuddyInvitationBundleRecord, decision: FrogSleepBuddyInvitationDomainDecisionRecord, expectedVersion: number) {
    if (bundle.status !== "pending" || Date.parse(bundle.expiresAt) <= Date.now() || decision.status !== "pending"
      || decision.version !== expectedVersion) {
      conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
    }
  }

  private isReplay(decision: FrogSleepBuddyInvitationDomainDecisionRecord, action: SafetyAction, idempotencyKey: string) {
    const status = action === "decline" ? "declined" : "cancelled";
    return decision.status === status && decision.idempotencyKeyHash === sha256(idempotencyKey);
  }

  private assertReplayVersion(decision: FrogSleepBuddyInvitationDomainDecisionRecord, expectedVersion: number) {
    if (expectedVersion !== decision.version - 1) {
      conflict("REQ_INVALID_BODY", "Buddy invitation decision version conflict.");
    }
  }

  private slotKeys(bundle: FrogSleepBuddyInvitationBundleRecord, domain: Domain) {
    return [{ appId: FROGSLEEP_APP_ID, userId: bundle.inviterUserId, domain },
      { appId: FROGSLEEP_APP_ID, userId: bundle.inviteeUserId!, domain }];
  }

  private payload(decision: FrogSleepBuddyInvitationDomainDecisionRecord) {
    return { invitation_id: decision.invitationId, domain: decision.domain,
      decision_status: decision.status, decision_version: decision.version };
  }
}

function unavailable() {
  return new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Buddy invitation is not available.");
}
