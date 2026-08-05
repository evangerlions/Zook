import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type { BodyLogProfileService } from "./bodylog-profile.service.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import {
  BODYLOG_REPORT_REASONS,
  type BodyLogFriendRequestRecord,
  type BodyLogReportReason,
} from "./bodylog-social.types.ts";

const FRIEND_LIMIT = 100;
const REPORT_REASONS = new Set<string>(BODYLOG_REPORT_REASONS);

export class BodyLogSocialService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly profiles: BodyLogProfileService,
  ) {}

  async listFriends(userId: string) {
    const friendships = await this.database.listBodyLogFriendships(BODYLOG_APP_ID);
    const friendIds = friendships
      .filter((item) => item.userId === userId || item.friendUserId === userId)
      .map((item) => item.userId === userId ? item.friendUserId : item.userId);
    return await Promise.all(friendIds.map(async (friendUserId) => ({
      ...(await this.profiles.getOrCreate(friendUserId)),
      friendsSince: friendships.find((item) =>
        (item.userId === userId && item.friendUserId === friendUserId) ||
        (item.userId === friendUserId && item.friendUserId === userId))?.createdAt,
    })));
  }

  async listRequests(userId: string) {
    const requests = (await this.database.listBodyLogFriendRequests(BODYLOG_APP_ID))
      .filter((item) => item.status === "pending" &&
        (item.senderUserId === userId || item.recipientUserId === userId));
    return await Promise.all(requests.map(async (request) => {
      const otherUserId = request.senderUserId === userId
        ? request.recipientUserId
        : request.senderUserId;
      return {
        id: request.id,
        direction: request.senderUserId === userId ? "outgoing" : "incoming",
        profile: await this.profiles.getOrCreate(otherUserId),
        createdAt: request.createdAt,
      };
    }));
  }

  async createRequest(userId: string, targetUserId: unknown) {
    if (typeof targetUserId !== "string" || !targetUserId.trim() || targetUserId === userId) {
      throw new ApplicationError(400, "BODYLOG_FRIEND_REQUEST_INVALID", "A different target user is required.");
    }
    const target = targetUserId.trim();
    const membership = await this.database.findAppUser(BODYLOG_APP_ID, target);
    if (!membership || membership.status !== "ACTIVE") {
      throw new ApplicationError(404, "BODYLOG_FRIEND_REQUEST_NOT_FOUND", "Target user was not found.");
    }
    await this.assertNotBlocked(userId, target);
    const friendships = await this.database.listBodyLogFriendships(BODYLOG_APP_ID);
    if (this.areFriends(friendships, userId, target)) {
      throw new ApplicationError(409, "BODYLOG_FRIEND_REQUEST_INVALID", "Users are already friends.");
    }
    const requests = await this.database.listBodyLogFriendRequests(BODYLOG_APP_ID);
    const duplicate = requests.find((item) => item.status === "pending" &&
      item.senderUserId === userId && item.recipientUserId === target);
    if (duplicate) return duplicate;

    const now = new Date().toISOString();
    return await this.database.upsertBodyLogFriendRequest({
      id: randomId("bodylog_friend_request"),
      appId: BODYLOG_APP_ID,
      senderUserId: userId,
      recipientUserId: target,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  }

  async respond(userId: string, requestId: string, action: "accept" | "reject") {
    const requests = await this.database.listBodyLogFriendRequests(BODYLOG_APP_ID);
    const request = requests.find((item) => item.id === requestId &&
      item.recipientUserId === userId && item.status === "pending");
    if (!request) {
      throw new ApplicationError(404, "BODYLOG_FRIEND_REQUEST_NOT_FOUND", "Friend request was not found.");
    }
    await this.assertNotBlocked(request.senderUserId, request.recipientUserId);
    if (action === "accept") {
      const friendships = await this.database.listBodyLogFriendships(BODYLOG_APP_ID);
      if (this.friendCount(friendships, request.senderUserId) >= FRIEND_LIMIT ||
          this.friendCount(friendships, request.recipientUserId) >= FRIEND_LIMIT) {
        throw new ApplicationError(409, "BODYLOG_FRIENDSHIP_LIMIT_REACHED", "Friend limit reached.");
      }
      await this.database.insertBodyLogFriendship({
        appId: BODYLOG_APP_ID,
        userId: request.senderUserId,
        friendUserId: request.recipientUserId,
        createdAt: new Date().toISOString(),
      });
    }
    const updated: BodyLogFriendRequestRecord = {
      ...request,
      status: action === "accept" ? "accepted" : "rejected",
      updatedAt: new Date().toISOString(),
    };
    await this.database.upsertBodyLogFriendRequest(updated);
    return { status: updated.status };
  }

  async removeFriend(userId: string, friendUserId: string) {
    await this.database.deleteBodyLogFriendship(BODYLOG_APP_ID, userId, friendUserId);
  }

  async listBlocks(userId: string) {
    const blocks = (await this.database.listBodyLogBlocks(BODYLOG_APP_ID))
      .filter((item) => item.blockerUserId === userId);
    return await Promise.all(blocks.map(async (item) => ({
      profile: await this.profiles.getOrCreate(item.blockedUserId),
      createdAt: item.createdAt,
    })));
  }

  async block(userId: string, targetUserId: unknown) {
    if (typeof targetUserId !== "string" || !targetUserId.trim() || targetUserId === userId) {
      throw new ApplicationError(400, "BODYLOG_FRIEND_REQUEST_INVALID", "A different target user is required.");
    }
    const target = targetUserId.trim();
    await this.database.insertBodyLogBlock({
      appId: BODYLOG_APP_ID,
      blockerUserId: userId,
      blockedUserId: target,
      createdAt: new Date().toISOString(),
    });
    await this.database.deleteBodyLogFriendship(BODYLOG_APP_ID, userId, target);
    const challengeMembers = await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID);
    const sharedChallengeIds = new Set(
      challengeMembers.filter((item) => item.userId === userId)
        .map((item) => item.challengeId)
        .filter((challengeId) => challengeMembers.some((item) =>
          item.challengeId === challengeId && item.userId === target)),
    );
    const challenges = await this.database.listBodyLogChallenges(BODYLOG_APP_ID);
    for (const challenge of challenges) {
      if (sharedChallengeIds.has(challenge.id) &&
          (challenge.status === "pending" || challenge.status === "active")) {
        await this.database.updateBodyLogChallenge({
          ...challenge, status: "cancelled", updatedAt: new Date().toISOString(),
        });
      }
    }
    const requests = await this.database.listBodyLogFriendRequests(BODYLOG_APP_ID);
    for (const request of requests) {
      if (request.status === "pending" &&
          ((request.senderUserId === userId && request.recipientUserId === target) ||
           (request.senderUserId === target && request.recipientUserId === userId))) {
        await this.database.upsertBodyLogFriendRequest({
          ...request,
          status: "rejected",
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async unblock(userId: string, targetUserId: string) {
    await this.database.deleteBodyLogBlock(BODYLOG_APP_ID, userId, targetUserId);
  }

  async report(userId: string, targetUserId: unknown, reason: unknown) {
    if (typeof targetUserId !== "string" || targetUserId === userId ||
        typeof reason !== "string" || !REPORT_REASONS.has(reason)) {
      throw new ApplicationError(400, "BODYLOG_REPORT_REASON_INVALID", "A valid report reason is required.");
    }
    const record = {
      id: randomId("bodylog_report"),
      appId: BODYLOG_APP_ID,
      reporterUserId: userId,
      reportedUserId: targetUserId,
      reason: reason as BodyLogReportReason,
      createdAt: new Date().toISOString(),
    };
    await this.database.insertBodyLogReport(record);
    return { id: record.id };
  }

  private async assertNotBlocked(left: string, right: string) {
    const blocks = await this.database.listBodyLogBlocks(BODYLOG_APP_ID);
    if (blocks.some((item) =>
      (item.blockerUserId === left && item.blockedUserId === right) ||
      (item.blockerUserId === right && item.blockedUserId === left))) {
      throw new ApplicationError(403, "BODYLOG_BLOCKED", "This social action is unavailable.");
    }
  }

  private areFriends(
    friendships: Awaited<ReturnType<ApplicationDatabase["listBodyLogFriendships"]>>,
    left: string,
    right: string,
  ) {
    return friendships.some((item) =>
      (item.userId === left && item.friendUserId === right) ||
      (item.userId === right && item.friendUserId === left));
  }

  private friendCount(
    friendships: Awaited<ReturnType<ApplicationDatabase["listBodyLogFriendships"]>>,
    userId: string,
  ) {
    return friendships.filter((item) =>
      item.userId === userId || item.friendUserId === userId).length;
  }
}
