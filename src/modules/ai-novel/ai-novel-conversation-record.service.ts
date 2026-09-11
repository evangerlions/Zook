import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type {
  AdminAiNovelConversationRecordDocument,
} from "../../shared/types.ts";
import { badRequest } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import { AI_NOVEL_APP_ID } from "./ai-novel-constants.ts";

const PAGE_SIZE_TURNS = 100;
const HIGH_WATER_MARK_TURNS = 120;
const RETAINED_TURNS = 100;

export const AI_NOVEL_USER_CONVERSATION_SCENES = [
  "kickoff_turn",
  "kickoff_turn_imported_book",
  "write_turn",
  "history_chapter_qa",
] as const;

export function isAiNovelUserConversationScene(sceneKey: string): boolean {
  return AI_NOVEL_USER_CONVERSATION_SCENES.includes(
    sceneKey as (typeof AI_NOVEL_USER_CONVERSATION_SCENES)[number],
  );
}

export class AiNovelConversationRecordService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordCompletedTurn(input: {
    userId: string;
    did?: string;
    requestId: string;
    messageId?: string;
    sessionId?: string;
    turnId?: string;
    sceneKey: string;
    userText: string;
    assistantText: string;
  }): Promise<void> {
    if (!isAiNovelUserConversationScene(input.sceneKey) || !input.userText.trim()) return;
    const messageId = normalizeOptionalId(input.messageId);
    const sessionId = normalizeOptionalId(input.sessionId);
    const turnId = normalizeOptionalId(input.turnId);

    await this.database.withExclusiveSession(async () => {
      const inserted = await this.database.aiNovelConversationStore.insert({
        id: randomId("ainovel_conversation"),
        appId: AI_NOVEL_APP_ID,
        userId: input.userId,
        did: normalizeOptionalDid(input.did),
        requestId: input.requestId,
        ...(messageId ? { messageId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(turnId ? { turnId } : {}),
        sceneKey: input.sceneKey,
        userText: input.userText,
        assistantText: input.assistantText,
        createdAt: this.now().toISOString(),
      });
      if (!inserted) return;
      await this.database.aiNovelConversationStore.trim({
        appId: AI_NOVEL_APP_ID,
        userId: input.userId,
        highWaterMark: HIGH_WATER_MARK_TURNS,
        retainCount: RETAINED_TURNS,
      });
    });
  }

  async listForAdmin(input: {
    uid?: string;
    did?: string;
    page?: number;
  }): Promise<AdminAiNovelConversationRecordDocument> {
    const uid = normalizeQueryIdentifier(input.uid, "uid");
    const did = normalizeQueryIdentifier(input.did, "did");
    if (uid && did) {
      badRequest("REQ_INVALID_QUERY", "Provide at most one of uid or did.");
    }
    const page = normalizePage(input.page);
    const records = await this.database.aiNovelConversationStore.list({
      appId: AI_NOVEL_APP_ID,
      ...(uid ? { userId: uid } : {}),
      ...(did ? { did } : {}),
      offset: page * PAGE_SIZE_TURNS,
      limit: PAGE_SIZE_TURNS + 1,
    });
    return {
      app: AI_NOVEL_APP_ID,
      query: {
        ...(uid ? { uid } : {}),
        ...(did ? { did } : {}),
      },
      page,
      pageSize: PAGE_SIZE_TURNS,
      hasMore: records.length > PAGE_SIZE_TURNS,
      items: records.slice(0, PAGE_SIZE_TURNS),
    };
  }
}

function normalizeOptionalDid(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= 200 ? normalized : undefined;
}

function normalizeOptionalId(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= 160 ? normalized : undefined;
}

function normalizeQueryIdentifier(value: string | undefined, field: "uid" | "did"): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    badRequest("REQ_INVALID_QUERY", `${field} must be 1 to 200 characters.`);
  }
  return normalized;
}

function normalizePage(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    badRequest("REQ_INVALID_QUERY", "page must be an integer from 0 to 10000.");
  }
  return value;
}
