import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type { BodyLogProfileService } from "./bodylog-profile.service.ts";
import { BODYLOG_APP_ID } from "./bodylog-profile.types.ts";
import { calculateBodyLogConsistencyScore } from "./bodylog-scoring.rules.ts";
import {
  BODYLOG_CHALLENGE_THEMES,
  type BodyLogChallengeMemberRecord,
  type BodyLogChallengeRecord,
  type BodyLogChallengeTheme,
} from "./bodylog-challenge.types.ts";

const THEMES = new Set<string>(BODYLOG_CHALLENGE_THEMES);

export class BodyLogChallengeService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly profiles: BodyLogProfileService,
  ) {}

  async create(userId: string, input: {
    themeKey: unknown;
    inviteeUserIds: unknown;
    timezone: unknown;
  }) {
    const themeKey = this.theme(input.themeKey);
    const timezone = validTimezone(input.timezone);
    if (!Array.isArray(input.inviteeUserIds) ||
        input.inviteeUserIds.some((item) => typeof item !== "string")) {
      throw invalid("Invite one to seven friends.");
    }
    const invitees = [...new Set(input.inviteeUserIds as string[])]
      .filter((item) => item !== userId);
    if (invitees.length < 1 || invitees.length > 7) {
      throw invalid("Challenges require two to eight members.");
    }
    const friendships = await this.database.listBodyLogFriendships(BODYLOG_APP_ID);
    const blocks = await this.database.listBodyLogBlocks(BODYLOG_APP_ID);
    for (const invitee of invitees) {
      const friend = friendships.some((item) =>
        (item.userId === userId && item.friendUserId === invitee) ||
        (item.userId === invitee && item.friendUserId === userId));
      const blocked = blocks.some((item) =>
        (item.blockerUserId === userId && item.blockedUserId === invitee) ||
        (item.blockerUserId === invitee && item.blockedUserId === userId));
      if (!friend || blocked) throw invalid("Only unblocked friends can be invited.");
    }
    const allChallenges = await this.database.listBodyLogChallenges(BODYLOG_APP_ID);
    const allMembers = await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID);
    const activeIds = new Set(allChallenges.filter((item) =>
      item.status === "pending" || item.status === "active").map((item) => item.id));
    for (const memberId of [userId, ...invitees]) {
      const count = allMembers.filter((item) =>
        item.userId === memberId && activeIds.has(item.challengeId) &&
        item.status !== "declined").length;
      if (count >= 3) {
        throw new ApplicationError(409, "BODYLOG_CHALLENGE_LIMIT_REACHED", "Concurrent challenge limit reached.");
      }
    }
    const now = new Date().toISOString();
    const challenge: BodyLogChallengeRecord = {
      id: randomId("bodylog_challenge"), appId: BODYLOG_APP_ID,
      creatorUserId: userId, themeKey, timezone, status: "pending",
      createdAt: now, updatedAt: now,
    };
    await this.database.insertBodyLogChallenge(challenge);
    await this.database.insertBodyLogChallengeMembers([
      {
        appId: BODYLOG_APP_ID, challengeId: challenge.id, userId,
        status: "accepted", completedDates: [], joinedAt: now, updatedAt: now,
      },
      ...invitees.map((invitee): BodyLogChallengeMemberRecord => ({
        appId: BODYLOG_APP_ID, challengeId: challenge.id, userId: invitee,
        status: "pending", completedDates: [], updatedAt: now,
      })),
    ]);
    return await this.document(challenge, userId);
  }

  async list(userId: string) {
    const challenges = await this.database.listBodyLogChallenges(BODYLOG_APP_ID);
    const members = await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID);
    const visible = challenges.filter((challenge) => members.some((member) =>
      member.challengeId === challenge.id && member.userId === userId &&
      member.status !== "declined"));
    return await Promise.all(visible.map(async (challenge) =>
      await this.document(challenge, userId)));
  }

  async get(userId: string, challengeId: string) {
    const challenge = (await this.database.listBodyLogChallenges(BODYLOG_APP_ID))
      .find((item) => item.id === challengeId);
    if (!challenge) throw notFound();
    return await this.document(challenge, userId);
  }

  async respond(userId: string, challengeId: string, action: unknown) {
    if (action !== "accept" && action !== "decline") throw invalid("Response is invalid.");
    const challenge = (await this.database.listBodyLogChallenges(BODYLOG_APP_ID))
      .find((item) => item.id === challengeId);
    const members = (await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID))
      .filter((item) => item.challengeId === challengeId);
    const member = members.find((item) => item.userId === userId && item.status === "pending");
    if (!challenge || !member || challenge.status !== "pending") throw notFound();
    const now = new Date().toISOString();
    await this.database.updateBodyLogChallengeMember({
      ...member, status: action === "accept" ? "accepted" : "declined",
      joinedAt: action === "accept" ? now : undefined, updatedAt: now,
    });
    if (action === "decline") {
      await this.database.updateBodyLogChallenge({
        ...challenge, status: "cancelled", updatedAt: now,
      });
    } else if (members.filter((item) => item.userId !== userId)
      .every((item) => item.status === "accepted")) {
      const startDate = addDays(todayIn(challenge.timezone), 1);
      await this.database.updateBodyLogChallenge({
        ...challenge, status: "active", startDate,
        endDate: addDays(startDate, 6), updatedAt: now,
      });
    }
    if (action === "decline") {
      return await this.document(
        { ...challenge, status: "cancelled", updatedAt: now },
        userId,
        true,
      );
    }
    return await this.get(userId, challengeId);
  }

  async recordProgress(
    userId: string,
    challengeId: string,
    input: { date: unknown; completed: unknown; timezone: unknown },
  ) {
    const challenges = await this.database.listBodyLogChallenges(BODYLOG_APP_ID);
    let challenge = challenges.find((item) => item.id === challengeId);
    if (!challenge || challenge.status !== "active" ||
        input.timezone !== challenge.timezone || typeof input.date !== "string" ||
        input.date !== todayIn(challenge.timezone) || typeof input.completed !== "boolean" ||
        !challenge.startDate || !challenge.endDate ||
        input.date < challenge.startDate || input.date > challenge.endDate) {
      throw new ApplicationError(400, "BODYLOG_CHALLENGE_PROGRESS_INVALID", "Challenge progress is invalid.");
    }
    const members = await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID);
    const member = members.find((item) =>
      item.challengeId === challengeId && item.userId === userId &&
      item.status === "accepted");
    if (!member) throw notFound();
    const dates = new Set(member.completedDates);
    if (input.completed) dates.add(input.date);
    else dates.delete(input.date);
    await this.database.updateBodyLogChallengeMember({
      ...member, completedDates: [...dates].sort(), updatedAt: new Date().toISOString(),
    });
    if (todayIn(challenge.timezone) > challenge.endDate) {
      challenge = { ...challenge, status: "settled", updatedAt: new Date().toISOString() };
      await this.database.updateBodyLogChallenge(challenge);
    }
    return await this.document(challenge, userId);
  }

  private async document(
    challenge: BodyLogChallengeRecord,
    viewerUserId: string,
    allowDeclined = false,
  ) {
    if (challenge.status === "active" && challenge.endDate &&
        todayIn(challenge.timezone) > challenge.endDate) {
      challenge = {
        ...challenge, status: "settled", updatedAt: new Date().toISOString(),
      };
      await this.database.updateBodyLogChallenge(challenge);
    }
    const members = (await this.database.listBodyLogChallengeMembers(BODYLOG_APP_ID))
      .filter((item) => item.challengeId === challenge.id);
    const viewer = members.find((item) => item.userId === viewerUserId);
    if (!viewer || (viewer.status === "declined" && !allowDeclined)) throw notFound();
    const blocks = await this.database.listBodyLogBlocks(BODYLOG_APP_ID);
    const visibleMembers = members.filter((member) => !blocks.some((block) =>
      (block.blockerUserId === viewerUserId && block.blockedUserId === member.userId) ||
      (block.blockerUserId === member.userId && block.blockedUserId === viewerUserId)));
    const scheduledDates = challenge.startDate && challenge.endDate
      ? datesBetween(challenge.startDate, challenge.endDate)
      : [];
    const scored = await Promise.all(visibleMembers.map(async (member) => {
      const profile = await this.profiles.getOrCreate(member.userId);
      const result = calculateBodyLogConsistencyScore({
        snapshot: {
          appId: BODYLOG_APP_ID, userId: member.userId,
          seasonLabel: challenge.id, timezone: challenge.timezone,
          habits: [{ habitId: "daily-plan", scheduledDates }],
          scheduledInstanceCount: scheduledDates.length, createdAt: challenge.createdAt,
        },
        completed: member.completedDates.map((date) => ({
          appId: BODYLOG_APP_ID, userId: member.userId, seasonLabel: challenge.id,
          date, completedHabitIds: ["daily-plan"], acceptedAt: member.updatedAt,
        })),
        reachedAt: member.updatedAt,
      });
      return {
        userId: member.userId, nickname: profile.nickname,
        avatarKey: profile.avatarKey, memberStatus: member.status,
        score: result.score, effectiveDays: result.effectiveQualifiedDays,
      };
    }));
    scored.sort((left, right) =>
      right.score - left.score || right.effectiveDays - left.effectiveDays ||
      left.userId.localeCompare(right.userId));
    return {
      id: challenge.id, themeKey: challenge.themeKey, status: challenge.status,
      timezone: challenge.timezone, startDate: challenge.startDate ?? null,
      endDate: challenge.endDate ?? null, currentUserStatus: viewer.status,
      members: scored.map((item, index) => ({ ...item, rank: index + 1 })),
      createdAt: challenge.createdAt, updatedAt: challenge.updatedAt,
    };
  }

  private theme(raw: unknown): BodyLogChallengeTheme {
    if (typeof raw !== "string" || !THEMES.has(raw)) throw invalid("Theme is invalid.");
    return raw as BodyLogChallengeTheme;
  }
}

function validTimezone(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("Time zone is required.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format();
    return raw;
  } catch {
    throw invalid("Time zone is invalid.");
  }
}

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, count: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let value = start; value <= end; value = addDays(value, 1)) dates.push(value);
  return dates;
}

function invalid(message: string) {
  return new ApplicationError(400, "BODYLOG_CHALLENGE_INVALID", message);
}

function notFound() {
  return new ApplicationError(404, "BODYLOG_CHALLENGE_NOT_FOUND", "Challenge was not found.");
}
