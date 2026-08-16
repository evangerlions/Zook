import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AppLogSecretService } from "./app-log-secret.service.ts";
import {
  AesGcmPayloadCryptoService,
  type AesGcmJsonEnvelope,
} from "./aes-gcm-payload-crypto.service.ts";
import {
  AI_OUTPUT_REPORT_CATEGORIES,
  AI_OUTPUT_REPORT_STATUSES,
  type AiOutputReactionRecord,
  type AiOutputReportCategory,
  type AiOutputReportRecord,
  type AuthContext,
} from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import { randomId, sha256 } from "../shared/utils.ts";

const AI_NOVEL_APP_ID = "ai_novel";
const REPORT_TARGET_TYPES = ["chat_message", "chapter_revision"] as const;
const REPORT_SCENES = ["kickoff", "write", "history_qa"] as const;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_REPORTED_CONTENT_CHARS = 100_000;

type ReportTargetType = typeof REPORT_TARGET_TYPES[number];
type ReportScene = typeof REPORT_SCENES[number];

interface SubmitReportCommand {
  auth: AuthContext;
  body: Record<string, unknown>;
  platform?: string;
  appVersion?: string;
  locale?: string;
}

interface SubmitReactionCommand {
  auth: AuthContext;
  body: Record<string, unknown>;
  platform?: string;
  appVersion?: string;
}

function requireString(
  body: Record<string, unknown>,
  key: string,
  maximum: number,
): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (!value || [...value].length > maximum) {
    badRequest("REQ_INVALID_BODY", `${key} is invalid.`);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  maximum: number,
): string | undefined {
  if (body[key] == null || body[key] === "") {
    return undefined;
  }
  return requireString(body, key, maximum);
}

function requireEnum<T extends string>(
  body: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = typeof body[key] === "string" ? body[key] : "";
  if (!values.includes(value as T)) {
    badRequest("REQ_INVALID_BODY", `${key} is invalid.`);
  }
  return value as T;
}

function optionalNonNegativeInt(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  if (body[key] == null) {
    return undefined;
  }
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    badRequest("REQ_INVALID_BODY", `${key} must be a non-negative integer.`);
  }
  return value;
}

function expectedContentHash(content: string): string {
  return `sha256:${sha256(content)}`;
}

function parseTargetMetadata(body: Record<string, unknown>): {
  messageId?: string;
  sessionId?: string;
  chapterId?: number;
  chapterRevisionId?: string;
} {
  const messageId = optionalString(body, "messageId", 160);
  const sessionId = optionalString(body, "sessionId", 160);
  const chapterId = optionalNonNegativeInt(body, "chapterId");
  const chapterRevisionId = optionalString(body, "chapterRevisionId", 160);
  return { messageId, sessionId, chapterId, chapterRevisionId };
}

export class AiOutputReportingService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly crypto: AesGcmPayloadCryptoService,
    private readonly appLogSecretService: AppLogSecretService,
  ) {}

  async submitReport(command: SubmitReportCommand) {
    return await this.database.withExclusiveSession(async () => {
      this.assertAiNovel(command.auth);
      const submissionId = requireString(
        command.body,
        "submissionId",
        120,
      );
      const existing = await this.database.findAiOutputReportBySubmission(
        command.auth.appId,
        command.auth.userId,
        submissionId,
      );
      if (existing) {
        return this.reportAccepted(existing);
      }

      const targetType = requireEnum(
        command.body,
        "targetType",
        REPORT_TARGET_TYPES,
      );
      const targetId = requireString(command.body, "targetId", 160);
      const targetFields = parseTargetMetadata(command.body);

      const category = requireEnum(
        command.body,
        "category",
        AI_OUTPUT_REPORT_CATEGORIES,
      );
      const scene = requireEnum(command.body, "scene", REPORT_SCENES);
      const description = optionalString(
        command.body,
        "description",
        MAX_DESCRIPTION_CHARS,
      );
      const reportedContent = requireString(
        command.body,
        "reportedContent",
        MAX_REPORTED_CONTENT_CHARS,
      );
      const contentHash = expectedContentHash(reportedContent);

      const encrypted = await this.encryptReportedContent(reportedContent);
      const membership = await this.database.findAppUser(
        command.auth.appId,
        command.auth.userId,
      );
      const now = new Date().toISOString();
      const record: AiOutputReportRecord = {
        id: randomId("ai_report"),
        submissionId,
        appId: command.auth.appId,
        userId: command.auth.userId,
        targetType,
        targetId,
        ...targetFields,
        scene,
        category,
        description,
        encryptedContentKeyId: encrypted.keyId,
        encryptedContentAlgorithm: encrypted.algorithm,
        encryptedContentNonceBase64: encrypted.nonceBase64,
        encryptedContentCiphertextBase64: encrypted.ciphertextBase64,
        contentHash,
        turnId: optionalString(command.body, "turnId", 160),
        providerRequestId: optionalString(
          command.body,
          "providerRequestId",
          200,
        ),
        modelKey: optionalString(command.body, "modelKey", 120),
        clientRegion: optionalString(command.body, "clientRegion", 20),
        accountRegion: membership?.accountRegion ?? "UNKNOWN",
        effectiveRegion: optionalString(command.body, "effectiveRegion", 20),
        platform:
          optionalString(command.body, "platform", 40) ?? command.platform,
        appVersion:
          optionalString(command.body, "appVersion", 40) ??
          command.appVersion,
        locale:
          optionalString(command.body, "locale", 40) ?? command.locale,
        status: "received",
        createdAt: now,
        updatedAt: now,
      };
      await this.database.insertAiOutputReport(record);
      return this.reportAccepted(record);
    });
  }

  async submitReaction(command: SubmitReactionCommand) {
    return await this.database.withExclusiveSession(async () => {
      this.assertAiNovel(command.auth);
      const submissionId = requireString(
        command.body,
        "submissionId",
        120,
      );
      const existing = await this.database.findAiOutputReactionBySubmission(
        command.auth.appId,
        command.auth.userId,
        submissionId,
      );
      if (existing) {
        return { reactionId: existing.id, accepted: true as const };
      }
      requireEnum(command.body, "targetType", ["chapter_revision"] as const);
      requireEnum(command.body, "reaction", ["like"] as const);
      const targetId = requireString(command.body, "targetId", 160);
      const chapterRevisionId = requireString(
        command.body,
        "chapterRevisionId",
        160,
      );
      if (targetId !== chapterRevisionId) {
        badRequest(
          "REQ_INVALID_BODY",
          "targetId must equal chapterRevisionId.",
        );
      }
      const chapterId = optionalNonNegativeInt(command.body, "chapterId");
      if (chapterId == null) {
        badRequest("REQ_INVALID_BODY", "chapterId is required.");
      }
      const record: AiOutputReactionRecord = {
        id: randomId("ai_reaction"),
        submissionId,
        appId: command.auth.appId,
        userId: command.auth.userId,
        targetType: "chapter_revision",
        targetId,
        reaction: "like",
        chapterId,
        chapterRevisionId,
        contentHash: requireString(command.body, "contentHash", 80),
        turnId: optionalString(command.body, "turnId", 160),
        providerRequestId: optionalString(
          command.body,
          "providerRequestId",
          200,
        ),
        platform:
          optionalString(command.body, "platform", 40) ?? command.platform,
        appVersion:
          optionalString(command.body, "appVersion", 40) ??
          command.appVersion,
        effectiveRegion: optionalString(
          command.body,
          "effectiveRegion",
          20,
        ),
        createdAt: new Date().toISOString(),
      };
      await this.database.insertAiOutputReaction(record);
      return { reactionId: record.id, accepted: true as const };
    });
  }

  async listReports(input: {
    category?: unknown;
    status?: unknown;
    limit?: unknown;
  }) {
    const category =
      input.category == null || input.category === ""
        ? undefined
        : this.parseCategory(input.category);
    const status =
      input.status == null || input.status === ""
        ? undefined
        : this.parseStatus(input.status);
    const numericLimit = Number(input.limit);
    const limit = Number.isFinite(numericLimit)
      ? Math.max(1, Math.min(Math.floor(numericLimit), 500))
      : 100;
    const records = await this.database.listAiOutputReports({
      appId: AI_NOVEL_APP_ID,
      category,
      status,
      limit,
    });
    return {
      app: AI_NOVEL_APP_ID,
      items: records.map((record) => this.adminSummary(record)),
    };
  }

  async getReport(reportId: string) {
    const record = await this.database.findAiOutputReportById(
      AI_NOVEL_APP_ID,
      reportId,
    );
    if (!record) {
      badRequest("REQ_INVALID_BODY", "AI output report was not found.");
    }
    return {
      ...this.adminSummary(record),
      reportedContent: await this.decryptReportedContent(record),
    };
  }

  async updateReportStatus(
    reportId: string,
    body: Record<string, unknown>,
  ) {
    const status = this.parseStatus(body.status);
    const resolutionCode = optionalString(body, "resolutionCode", 120);
    const resolutionNote = optionalString(body, "resolutionNote", 2000);
    const record = await this.database.updateAiOutputReportStatus(
      AI_NOVEL_APP_ID,
      reportId,
      status,
      resolutionCode,
      resolutionNote,
    );
    if (!record) {
      badRequest("REQ_INVALID_BODY", "AI output report was not found.");
    }
    return this.adminSummary(record);
  }

  private async encryptReportedContent(
    content: string,
  ): Promise<AesGcmJsonEnvelope> {
    const ensured = await this.appLogSecretService.ensureSecret(
      AI_NOVEL_APP_ID,
    );
    return await this.crypto.encryptJsonEnvelope(
      Buffer.from(content, "utf8"),
      ensured.record.keyId,
    );
  }

  private async decryptReportedContent(
    record: AiOutputReportRecord,
  ): Promise<string> {
    const plaintext = await this.crypto.decrypt({
      algorithm: record.encryptedContentAlgorithm,
      keyId: record.encryptedContentKeyId,
      nonceBase64: record.encryptedContentNonceBase64,
      ciphertext: Buffer.from(
        record.encryptedContentCiphertextBase64,
        "base64",
      ),
    });
    return plaintext.toString("utf8");
  }

  private reportAccepted(record: AiOutputReportRecord) {
    return {
      reportId: record.id,
      accepted: true as const,
      status: "received" as const,
    };
  }

  private adminSummary(record: AiOutputReportRecord) {
    const {
      encryptedContentKeyId: _keyId,
      encryptedContentAlgorithm: _algorithm,
      encryptedContentNonceBase64: _nonce,
      encryptedContentCiphertextBase64: _ciphertext,
      ...summary
    } = record;
    return summary;
  }

  private assertAiNovel(auth: AuthContext): void {
    if (auth.appId !== AI_NOVEL_APP_ID) {
      badRequest(
        "AUTH_APP_SCOPE_MISMATCH",
        "AI output reporting is limited to ai_novel.",
      );
    }
  }

  private parseCategory(value: unknown): AiOutputReportCategory {
    if (
      typeof value !== "string" ||
      !AI_OUTPUT_REPORT_CATEGORIES.includes(value as AiOutputReportCategory)
    ) {
      badRequest("REQ_INVALID_BODY", "Report category is invalid.");
    }
    return value as AiOutputReportCategory;
  }

  private parseStatus(value: unknown): AiOutputReportRecord["status"] {
    if (
      typeof value !== "string" ||
      !AI_OUTPUT_REPORT_STATUSES.includes(
        value as AiOutputReportRecord["status"],
      )
    ) {
      badRequest("REQ_INVALID_BODY", "Report status is invalid.");
    }
    return value as AiOutputReportRecord["status"];
  }
}
