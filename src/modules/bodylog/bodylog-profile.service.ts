import { ApplicationError } from "../../shared/errors.ts";
import type { ContentSafetyService } from "../../services/content-safety.service.ts";
import {
  BODYLOG_APP_ID,
  BODYLOG_AVATAR_KEYS,
  type BodyLogAvatarKey,
  type BodyLogProfileDocument,
  type BodyLogProfileRecord,
} from "./bodylog-profile.types.ts";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";

const ALLOWED_AVATARS = new Set<string>(BODYLOG_AVATAR_KEYS);
const DEFAULT_NICKNAME = "BodyLog 用户";
const DEFAULT_AVATAR: BodyLogAvatarKey = "mint_runner";

export function normalizeBodyLogNickname(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ApplicationError(
      400,
      "BODYLOG_NICKNAME_INVALID",
      "Nickname is required.",
    );
  }
  const value = raw.trim();
  const length = [...value].length;
  if (length < 2 || length > 20) {
    throw new ApplicationError(
      400,
      "BODYLOG_NICKNAME_INVALID",
      "Nickname must contain 2 to 20 characters.",
    );
  }
  return value;
}

function normalizeBodyLogAvatar(raw: unknown): BodyLogAvatarKey {
  if (typeof raw !== "string" || !ALLOWED_AVATARS.has(raw)) {
    throw new ApplicationError(
      400,
      "BODYLOG_AVATAR_INVALID",
      "Avatar is not supported.",
    );
  }
  return raw as BodyLogAvatarKey;
}

function toDocument(record: BodyLogProfileRecord): BodyLogProfileDocument {
  return {
    userId: record.userId,
    nickname: record.nickname,
    avatarKey: record.avatarKey,
    profileCompleted: record.profileCompleted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class BodyLogProfileService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly contentSafetyService: ContentSafetyService,
  ) {}

  async getOrCreate(userId: string): Promise<BodyLogProfileDocument> {
    const existing = await this.database.findBodyLogProfile(
      BODYLOG_APP_ID,
      userId,
    );
    if (existing) {
      return toDocument(existing);
    }

    const now = new Date().toISOString();
    const created = await this.database.upsertBodyLogProfile({
      appId: BODYLOG_APP_ID,
      userId,
      nickname: DEFAULT_NICKNAME,
      avatarKey: DEFAULT_AVATAR,
      profileCompleted: false,
      createdAt: now,
      updatedAt: now,
    });
    return toDocument(created);
  }

  async update(
    userId: string,
    input: { nickname: unknown; avatarKey: unknown },
    requestId?: string,
  ): Promise<BodyLogProfileDocument> {
    const nickname = normalizeBodyLogNickname(input.nickname);
    const avatarKey = normalizeBodyLogAvatar(input.avatarKey);
    try {
      await this.contentSafetyService.assertUserInputAllowed({
        appId: BODYLOG_APP_ID,
        userId,
        requestId,
        taskType: "bodylog_profile_nickname",
        source: "business",
        text: nickname,
      });
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        error.code === "AI_INPUT_CONTENT_SENSITIVE"
      ) {
        throw new ApplicationError(
          422,
          "BODYLOG_PROFILE_UNSAFE",
          "Nickname cannot be used.",
        );
      }
      throw error;
    }

    const existing = await this.database.findBodyLogProfile(
      BODYLOG_APP_ID,
      userId,
    );
    const now = new Date().toISOString();
    const updated = await this.database.upsertBodyLogProfile({
      appId: BODYLOG_APP_ID,
      userId,
      nickname,
      avatarKey,
      profileCompleted: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return toDocument(updated);
  }
}
