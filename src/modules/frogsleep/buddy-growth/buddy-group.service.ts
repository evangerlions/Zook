import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { badRequest, conflict, forbidden } from "../../../shared/errors.ts";
import type { UserRecord } from "../../../shared/types.ts";
import type {
  FrogSleepBuddyGroupRecord,
  FrogSleepBuddyGroupMemberRecord,
  FrogSleepBuddyGroupInvitationRecord,
} from "../../../shared/types.ts";
import { randomId } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { enqueueBuddyGrowthEvent } from "./buddy-growth-events.ts";
import { BuddyRateLimiter } from "./buddy-rate-limit.ts";
import { buddyGroupMemberRoles, buddySharingCategories } from "./buddy-growth-contract.ts";

const MAX_GROUP_MEMBERS = 5;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_LIMIT_PER_USER = 5;
const ALLOWED_SHARING_CATEGORIES = new Set<string>(buddySharingCategories);

/** Coordinates 2-5 person buddy group lifecycle, membership, invitations, and privacy. */
export class BuddyGroupService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager?: KVManager,
  ) {}

  /** Creates a group with the creator as owner and optional initial invitations. */
  async create(userId: string, input: Record<string, unknown>) {
    const domain = normalizeDomain(input.domain);
    const groupName = requiredText(input.group_name ?? input.groupName, "group_name");
    const description = optionalText(input.group_description ?? input.groupDescription);
    const baseline = this.normalizeBaseline(input.sharing_baseline ?? input.sharingBaseline);
    const inviteTargets = Array.isArray(input.invitees) ? input.invitees : [];
    if (this.kvManager) {
      await new BuddyRateLimiter(this.kvManager).assert("group_create", userId, 10, 60 * 60_000);
    }
    const existing = await this.database.listFrogSleepBuddyGroupsForOwner(FROGSLEEP_APP_ID, userId);
    if (existing.filter((group) => group.status === "active").length >= GROUP_LIMIT_PER_USER) {
      badRequest("BUDDY_GROUP_LIMIT", "Too many active buddy groups.");
    }
    const now = new Date().toISOString();
    const groupId = randomId("buddy_group");
    const group: FrogSleepBuddyGroupRecord = {
      id: groupId, appId: FROGSLEEP_APP_ID, domain, groupName,
      groupDescription: description, ownerUserId: userId,
      status: "forming", memberCount: 1, sharingBaseline: baseline,
      version: 1, createdAt: now, updatedAt: now,
    };
    return await this.database.withExclusiveSession(async () => {
      await this.database.insertFrogSleepBuddyGroup(group);
      await this.database.insertFrogSleepBuddyGroupMember({
        id: randomId("buddy_group_member"), appId: FROGSLEEP_APP_ID, groupId,
        userId, role: "owner", status: "active", version: 1,
        joinedAt: now, createdAt: now, updatedAt: now,
      });
      const invitations: FrogSleepBuddyGroupInvitationRecord[] = [];
      for (const target of inviteTargets) {
        const created = await this.createInvitation(userId, group, target);
        if (created) invitations.push(created);
      }
      return this.groupDetail(group, [await this.requireMember(groupId, userId)], invitations);
    });
  }

  async list(userId: string) {
    const groups = await this.database.listFrogSleepBuddyGroupsForUser(FROGSLEEP_APP_ID, userId);
    const owned = await this.database.listFrogSleepBuddyGroupsForOwner(FROGSLEEP_APP_ID, userId);
    const merged = new Map(groups.concat(owned).map((group) => [group.id, group]));
    const results = await Promise.all([...merged.values()].sort(byUpdatedAt).map(async (group) => {
      const myMember = await this.database.findFrogSleepBuddyGroupMember(FROGSLEEP_APP_ID, group.id, userId);
      return this.summary(group, myMember);
    }));
    return { groups: results };
  }

  async get(userId: string, groupId: string) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    const members = await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, groupId);
    const invitations = await this.database.listFrogSleepBuddyGroupInvitations(FROGSLEEP_APP_ID, groupId);
    return this.groupDetail(group, members, invitations, member);
  }

  /** Group home: member presence states, viewer-filtered summaries, and recent activity. */
  async hub(userId: string, groupId: string) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (group.status === "paused") {
      forbidden("BUDDY_GROUP_PAUSED", "Group is paused.");
    }
    const members = await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, groupId);
    const activeMembers = members.filter((item) => item.status === "active");
    const memberSnapshots = await Promise.all(activeMembers.map(async (item) => {
      const user = await this.database.findUserById(item.userId);
      return {
        user_id: item.userId,
        display_name: displayName(user),
        role: item.role,
        status: item.status,
        presence_state: await this.presenceFor(group, item, member),
      };
    }));
    const activities = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind: "buddy_interaction", relationshipId: groupId, limit: 10,
    });
    return {
      group: this.summary(group, member),
      members: memberSnapshots,
      recent_activity: activities
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((item) => ({ interaction_id: item.id, type: String(item.payload.type ?? ""),
          actor_user_id: item.ownerUserId, created_at: item.createdAt })),
      sharing_baseline: group.sharingBaseline,
      viewer_actions: this.viewerActions(group, member),
      generated_at: new Date().toISOString(),
    };
  }

  async update(userId: string, groupId: string, input: Record<string, unknown>) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (member.role !== "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "Only the group owner can update the group.");
    const groupName = requiredText(input.group_name ?? input.groupName ?? group.groupName, "group_name");
    const description = input.group_description !== undefined || input.groupDescription !== undefined
      ? optionalText(input.group_description ?? input.groupDescription) : group.groupDescription;
    const baseline = input.sharing_baseline !== undefined || input.sharingBaseline !== undefined
      ? this.normalizeBaseline(input.sharing_baseline ?? input.sharingBaseline) : group.sharingBaseline;
    const updated = await this.database.compareAndUpdateFrogSleepBuddyGroup({
      appId: FROGSLEEP_APP_ID, id: group.id, expectedVersion: group.version,
      status: group.status, memberCount: group.memberCount, sharingBaseline: baseline,
      groupName, groupDescription: description, groupDescriptionSpecified: true,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) conflictGroup();
    const merged = { ...updated, groupName, groupDescription: description };
    return this.summary(merged, member);
  }

  async invite(userId: string, groupId: string, input: Record<string, unknown>) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (group.status === "dissolved" || group.status === "paused") {
      forbidden("BUDDY_GROUP_UNAVAILABLE", "Group is not accepting invitations.");
    }
    if (member.role !== "owner" && member.role !== "moderator") {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Only owners and moderators can invite.");
    }
    const targets = Array.isArray(input.invitees) && input.invitees.length > 0
      ? input.invitees : [input];
    const results: FrogSleepBuddyGroupInvitationRecord[] = [];
    for (const target of targets) {
      const created = await this.createInvitation(userId, group, target);
      if (created) results.push(created);
    }
    return { invitations: results.map((item) => this.invitationView(item)) };
  }

  async respondInvitation(userId: string, invitationId: string, action: "accept" | "decline" | "cancel") {
    const invitation = await this.database.findFrogSleepBuddyGroupInvitation(FROGSLEEP_APP_ID, invitationId);
    if (!invitation) badRequest("BUDDY_GROUP_INVITATION_NOT_FOUND", "Group invitation not found.");
    if (invitation.status !== "pending") badRequest("BUDDY_GROUP_INVITATION_HANDLED", "Group invitation already handled.");
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      await this.updateInvitation(invitation, "expired");
      badRequest("BUDDY_GROUP_INVITATION_EXPIRED", "Group invitation has expired.");
    }
    if (action === "accept") return await this.acceptInvitation(userId, invitation);
    if (action === "decline") {
      if (invitation.inviteeUserId && invitation.inviteeUserId !== userId) {
        forbidden("BUDDY_GROUP_FORBIDDEN", "Not this invitation's recipient.");
      }
      await this.updateInvitation(invitation, "declined");
      return { invitation_id: invitation.id, status: "declined" };
    }
    const inviter = await this.requireMember(invitation.groupId, userId).catch(() => undefined);
    if (invitation.inviterUserId !== userId && inviter?.role !== "owner") {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Only the inviter or owner can cancel.");
    }
    await this.updateInvitation(invitation, "cancelled");
    return { invitation_id: invitation.id, status: "cancelled" };
  }

  async acceptByLocator(userId: string, locator: { invitationId?: string; token?: string; code?: string }) {
    const invitation = locator.invitationId
      ? await this.database.findFrogSleepBuddyGroupInvitation(FROGSLEEP_APP_ID, locator.invitationId)
      : undefined;
    if (!invitation) badRequest("BUDDY_GROUP_INVITATION_NOT_FOUND", "Group invitation not found.");
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      await this.updateInvitation(invitation, "expired");
      badRequest("BUDDY_GROUP_INVITATION_EXPIRED", "Group invitation has expired.");
    }
    return await this.acceptInvitation(userId, invitation);
  }

  async removeMember(userId: string, groupId: string, targetUserId: string) {
    const group = await this.requireGroup(groupId);
    const actor = await this.requireMember(groupId, userId);
    const target = await this.requireMember(groupId, targetUserId);
    if (actor.role !== "owner" && actor.role !== "moderator") {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Only owners and moderators can remove members.");
    }
    if (target.role === "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "The group owner cannot be removed.");
    if (actor.role === "moderator" && target.role === "moderator") {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Moderators cannot remove other moderators.");
    }
    await this.updateMember(target, "removed");
    await this.syncMemberCount(group);
    await enqueueBuddyGrowthEvent(this.database, {
      recipientUserId: targetUserId, eventType: "group_member_left",
      targetType: "buddy_group", targetId: group.id, relationshipId: group.id,
      deduplicationKey: `group:${group.id}:removed:${targetUserId}`,
    });
    return { group_id: group.id, removed_user_id: targetUserId };
  }

  async changeRole(userId: string, groupId: string, targetUserId: string, input: Record<string, unknown>) {
    const group = await this.requireGroup(groupId);
    const actor = await this.requireMember(groupId, userId);
    const target = await this.requireMember(groupId, targetUserId);
    if (actor.role !== "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "Only the group owner can change roles.");
    const role = String(input.role ?? "");
    if (!buddyGroupMemberRoles.includes(role as typeof buddyGroupMemberRoles[number])) {
      badRequest("REQ_INVALID_BODY", "Invalid group member role.");
    }
    if (role === "owner") {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Transfer ownership through a separate flow.");
    }
    if (target.role === "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "The group owner role cannot be changed.");
    await this.database.compareAndUpdateFrogSleepBuddyGroupMember({
      appId: FROGSLEEP_APP_ID, groupId, userId: targetUserId,
      expectedVersion: target.version, role: role as FrogSleepBuddyGroupMemberRecord["role"],
      status: target.status, updatedAt: new Date().toISOString(),
    });
    return { group_id: groupId, user_id: targetUserId, role };
  }

  async leave(userId: string, groupId: string) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (member.role === "owner") {
      const owners = (await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, groupId))
        .filter((item) => item.role === "owner" && item.status === "active");
      if (owners.length <= 1) {
        forbidden("BUDDY_GROUP_OWNER", "The owner must dissolve the group or transfer ownership first.");
      }
    }
    await this.updateMember(member, "left");
    await this.syncMemberCount(group);
    return { group_id: groupId, status: "left" };
  }

  async pause(userId: string, groupId: string) {
    return await this.groupStateChange(userId, groupId, "paused");
  }

  async resume(userId: string, groupId: string) {
    return await this.groupStateChange(userId, groupId, "active");
  }

  async dissolve(userId: string, groupId: string) {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (member.role !== "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "Only the group owner can dissolve the group.");
    const now = new Date().toISOString();
    await this.database.compareAndUpdateFrogSleepBuddyGroup({
      appId: FROGSLEEP_APP_ID, id: group.id, expectedVersion: group.version,
      status: "dissolved", memberCount: group.memberCount, sharingBaseline: group.sharingBaseline,
      dissolvedAt: now, updatedAt: now,
    });
    const members = (await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, groupId))
      .filter((item) => item.status === "active" && item.userId !== userId);
    for (const item of members) {
      await enqueueBuddyGrowthEvent(this.database, {
        recipientUserId: item.userId, eventType: "group_dissolved",
        targetType: "buddy_group", targetId: group.id, relationshipId: group.id,
        deduplicationKey: `group:${group.id}:dissolved`,
      });
    }
    return { group_id: group.id, status: "dissolved" };
  }

  /** View of member→group grants as a single baseline with viewer opt-outs. */
  async grants(userId: string, groupId: string) {
    const group = await this.requireGroup(groupId);
    await this.requireMember(groupId, userId);
    const members = (await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, groupId))
      .filter((item) => item.status === "active");
    return {
      group_id: group.id,
      sharing_baseline: group.sharingBaseline,
      grants: members.map((item) => ({
        user_id: item.userId,
        categories: group.sharingBaseline,
        state: "granted",
      })),
    };
  }

  private async acceptInvitation(userId: string, invitation: FrogSleepBuddyGroupInvitationRecord) {
    const group = await this.database.findFrogSleepBuddyGroup(FROGSLEEP_APP_ID, invitation.groupId);
    if (!group || group.status === "dissolved") {
      await this.updateInvitation(invitation, "expired");
      badRequest("BUDDY_GROUP_UNAVAILABLE", "Group is no longer accepting members.");
    }
    if (invitation.inviteeUserId && invitation.inviteeUserId !== userId) {
      forbidden("BUDDY_GROUP_FORBIDDEN", "Not this invitation's recipient.");
    }
    if (group.status === "paused") forbidden("BUDDY_GROUP_PAUSED", "Group is paused.");
    if (group.memberCount >= MAX_GROUP_MEMBERS) badRequest("BUDDY_GROUP_FULL", "Group is full.");
    const existing = await this.database.findFrogSleepBuddyGroupMember(FROGSLEEP_APP_ID, group.id, userId);
    if (existing && existing.status === "active") {
      await this.updateInvitation(invitation, "accepted");
      return { group_id: group.id, status: "already_member", member_count: group.memberCount };
    }
    const now = new Date().toISOString();
    const memberCount = group.memberCount + (existing && existing.status === "invited" ? 0 : 1);
    return await this.database.withExclusiveSession(async () => {
      const updatedGroup = await this.database.compareAndUpdateFrogSleepBuddyGroup({
        appId: FROGSLEEP_APP_ID, id: group.id, expectedVersion: group.version,
        status: memberCount >= 2 && group.status === "forming" ? "active" : group.status,
        memberCount, sharingBaseline: group.sharingBaseline, updatedAt: now,
      });
      if (!updatedGroup) conflictGroup();
      await this.database.insertFrogSleepBuddyGroupMember({
        id: existing?.id ?? randomId("buddy_group_member"), appId: FROGSLEEP_APP_ID, groupId: group.id,
        userId, role: "member", status: "active", version: 1,
        joinedAt: now, createdAt: now, updatedAt: now,
      });
      await this.updateInvitation(invitation, "accepted");
      await enqueueBuddyGrowthEvent(this.database, {
        recipientUserId: invitation.inviterUserId, eventType: "group_invitation_accepted",
        targetType: "buddy_group", targetId: group.id, relationshipId: group.id,
        deduplicationKey: `group:${group.id}:invitation:${invitation.id}`,
      });
      for (const other of (await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, group.id))
        .filter((item) => item.status === "active" && item.userId !== userId)) {
        await enqueueBuddyGrowthEvent(this.database, {
          recipientUserId: other.userId, eventType: "group_member_joined",
          targetType: "buddy_group", targetId: group.id, relationshipId: group.id,
          deduplicationKey: `group:${group.id}:joined:${userId}`,
        });
      }
      return { group_id: group.id, status: "accepted", member_count: updatedGroup.memberCount };
    });
  }

  private async createInvitation(
    inviterUserId: string,
    group: FrogSleepBuddyGroupRecord,
    target: unknown,
  ): Promise<FrogSleepBuddyGroupInvitationRecord | undefined> {
    if (!target || typeof target !== "object") return undefined;
    const body = target as Record<string, unknown>;
    const inviteeUserId = optionalUserId(body.user_id ?? body.userId);
    const inviteeEmail = optionalEmail(body.email);
    if (!inviteeUserId && !inviteeEmail) badRequest("REQ_INVALID_BODY", "Invitation target must include user_id or email.");
    if (group.memberCount + 1 > MAX_GROUP_MEMBERS) badRequest("BUDDY_GROUP_FULL", "Group is full.");
    if (inviteeUserId === inviterUserId) badRequest("REQ_INVALID_BODY", "Cannot invite yourself.");
    const existingInvite = (await this.database.listFrogSleepBuddyGroupInvitations(FROGSLEEP_APP_ID, group.id))
      .find((item) => item.status === "pending"
        && ((inviteeUserId && item.inviteeUserId === inviteeUserId)
          || (!inviteeUserId && inviteeEmail && item.inviteeEmail === inviteeEmail)));
    if (existingInvite) return existingInvite;
    const now = new Date().toISOString();
    const record: FrogSleepBuddyGroupInvitationRecord = {
      id: randomId("buddy_group_invite"), appId: FROGSLEEP_APP_ID, groupId: group.id,
      inviterUserId, inviteeUserId, inviteeEmail,
      status: "pending", version: 1,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      createdAt: now, updatedAt: now,
    };
    await this.database.insertFrogSleepBuddyGroupInvitation(record);
    if (inviteeUserId) {
      await enqueueBuddyGrowthEvent(this.database, {
        recipientUserId: inviteeUserId, eventType: "group_invitation_received",
        targetType: "buddy_group_invitation", targetId: record.id, relationshipId: group.id,
        deduplicationKey: `group:${group.id}:invite:${record.id}`,
      });
    }
    return record;
  }

  private async updateInvitation(invitation: FrogSleepBuddyGroupInvitationRecord, status: FrogSleepBuddyGroupInvitationRecord["status"]) {
    return await this.database.compareAndUpdateFrogSleepBuddyGroupInvitation({
      appId: FROGSLEEP_APP_ID, invitationId: invitation.id, expectedVersion: invitation.version,
      status, respondedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  private async updateMember(member: FrogSleepBuddyGroupMemberRecord, status: "left" | "removed") {
    return await this.database.compareAndUpdateFrogSleepBuddyGroupMember({
      appId: FROGSLEEP_APP_ID, groupId: member.groupId, userId: member.userId,
      expectedVersion: member.version, role: member.role, status,
      leftAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  private async syncMemberCount(group: FrogSleepBuddyGroupRecord) {
    const activeCount = (await this.database.listFrogSleepBuddyGroupMembers(FROGSLEEP_APP_ID, group.id))
      .filter((item) => item.status === "active").length;
    const now = new Date().toISOString();
    return await this.database.compareAndUpdateFrogSleepBuddyGroup({
      appId: FROGSLEEP_APP_ID, id: group.id, expectedVersion: group.version,
      status: activeCount >= 2 ? "active" : activeCount === 0 ? "dissolved" : "forming",
      memberCount: activeCount, sharingBaseline: group.sharingBaseline,
      dissolvedAt: activeCount === 0 ? now : group.dissolvedAt,
      updatedAt: now,
    });
  }

  private async groupStateChange(userId: string, groupId: string, status: "paused" | "active") {
    const group = await this.requireGroup(groupId);
    const member = await this.requireMember(groupId, userId);
    if (member.role !== "owner") forbidden("BUDDY_GROUP_FORBIDDEN", "Only the group owner can change group state.");
    const updated = await this.database.compareAndUpdateFrogSleepBuddyGroup({
      appId: FROGSLEEP_APP_ID, id: group.id, expectedVersion: group.version,
      status, memberCount: group.memberCount, sharingBaseline: group.sharingBaseline,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) conflictGroup();
    return this.summary(updated, member);
  }

  private async requireGroup(groupId: string): Promise<FrogSleepBuddyGroupRecord> {
    const group = await this.database.findFrogSleepBuddyGroup(FROGSLEEP_APP_ID, groupId);
    if (!group) badRequest("BUDDY_GROUP_NOT_FOUND", "Buddy group not found.");
    return group;
  }

  private async requireMember(groupId: string, userId: string): Promise<FrogSleepBuddyGroupMemberRecord> {
    const member = await this.database.findFrogSleepBuddyGroupMember(FROGSLEEP_APP_ID, groupId, userId);
    if (!member || member.status !== "active") forbidden("BUDDY_GROUP_NOT_MEMBER", "You are not an active member of this group.");
    return member;
  }

  private async presenceFor(
    group: FrogSleepBuddyGroupRecord,
    owner: FrogSleepBuddyGroupMemberRecord,
    viewer: FrogSleepBuddyGroupMemberRecord,
  ): Promise<string | undefined> {
    if (!group.sharingBaseline.includes("presence")) return undefined;
    const entities = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID, kind: group.domain === "sleep" ? "sleep_session" : "focus_session",
      ownerUserId: owner.userId, limit: 1,
    });
    void viewer;
    const latest = entities.sort((left, right) => right.startsAt?.localeCompare(left.startsAt ?? "") ?? 0)[0];
    if (!latest) return undefined;
    const status = String(latest.status ?? "");
    if (status === "active" || status === "running") return "active";
    if (status === "completed") return "completed";
    return undefined;
  }

  private summary(group: FrogSleepBuddyGroupRecord, myMember?: FrogSleepBuddyGroupMemberRecord) {
    return {
      group_id: group.id,
      domain: group.domain,
      name: group.groupName,
      description: group.groupDescription,
      status: group.status,
      member_count: group.memberCount,
      my_role: myMember?.role,
      sharing_baseline: group.sharingBaseline,
      updated_at: group.updatedAt,
      created_at: group.createdAt,
    };
  }

  private groupDetail(
    group: FrogSleepBuddyGroupRecord,
    members: FrogSleepBuddyGroupMemberRecord[],
    invitations: FrogSleepBuddyGroupInvitationRecord[],
    myMember?: FrogSleepBuddyGroupMemberRecord,
  ) {
    return {
      ...this.summary(group, myMember),
      members: members.map((item) => ({
        user_id: item.userId, role: item.role, status: item.status,
        joined_at: item.joinedAt,
      })),
      invitations: invitations.map((item) => this.invitationView(item)),
      viewer_actions: this.viewerActions(group, myMember),
    };
  }

  private invitationView(invitation: FrogSleepBuddyGroupInvitationRecord) {
    return {
      invitation_id: invitation.id,
      group_id: invitation.groupId,
      inviter_user_id: invitation.inviterUserId,
      invitee_user_id: invitation.inviteeUserId,
      invitee_email: invitation.inviteeEmail ? maskEmail(invitation.inviteeEmail) : undefined,
      status: invitation.status,
      expires_at: invitation.expiresAt,
      created_at: invitation.createdAt,
    };
  }

  private viewerActions(group: FrogSleepBuddyGroupRecord, member?: FrogSleepBuddyGroupMemberRecord): string[] {
    const actions = ["invite"];
    if (member?.role === "owner") {
      actions.push("pause", "resume", "dissolve", "remove_member", "change_role");
    } else if (member?.role === "moderator") {
      actions.push("remove_member");
    }
    if (group.status === "active" || group.status === "forming") actions.push("leave");
    return actions;
  }

  private normalizeBaseline(value: unknown): string[] {
    const categories = Array.isArray(value) && value.length > 0
      ? value.map(String) : ["presence", "daily_summary"];
    for (const category of categories) {
      if (!ALLOWED_SHARING_CATEGORIES.has(category)) {
        badRequest("REQ_INVALID_BODY", `Unsupported sharing category: ${category}`);
      }
    }
    return [...new Set(categories)];
  }
}

function normalizeDomain(value: unknown): "sleep" | "focus" {
  if (value === "sleep" || value === "focus") return value;
  badRequest("REQ_INVALID_BODY", "Group domain must be sleep or focus.");
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 40) {
    badRequest("REQ_INVALID_BODY", `Invalid ${name}.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length > 0 && text.length <= 160 ? text : undefined;
}

function optionalUserId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function displayName(user?: UserRecord): string {
  return user?.email?.split("@")[0] ?? "FrogSleep buddy";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

function byUpdatedAt(left: FrogSleepBuddyGroupRecord, right: FrogSleepBuddyGroupRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function conflictGroup(): never {
  conflict("BUDDY_GROUP_CONFLICT", "Buddy group was modified concurrently.");
}
