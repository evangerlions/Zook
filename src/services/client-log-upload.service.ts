import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { badRequest, conflict, payloadTooLarge } from "../shared/errors.ts";
import type {
  AuthContext,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  LogFailCommand,
  LogFailResult,
  LogNoDataAckResult,
  LogPolicyResult,
  LogPullTaskResult,
  LogUploadResult,
} from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AppRemoteLogPullService } from "./app-remote-log-pull.service.ts";
import {
  AesGcmPayloadCryptoError,
  AesGcmPayloadCryptoService,
  type AesGcmEncryptionKeyResolver,
} from "./aes-gcm-payload-crypto.service.ts";

const AES_256_GCM = "aes-256-gcm";
const NDJSON_GZIP = "ndjson+gzip";
const DEFAULT_MAX_ENCRYPTED_PAYLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_LOG_UPLOAD_STORAGE_DIR = ".storage/client-log-uploads";
export type ClientLogEncryptionKeyResolver = AesGcmEncryptionKeyResolver;

export interface UploadClientLogsCommand {
  auth: AuthContext;
  did: string;
  taskId: string;
  claimToken: string;
  keyId: string;
  encryption: string;
  nonceBase64: string;
  contentEncoding: string;
  body: Buffer;
  lineCountReported?: number;
  plainBytesReported?: number;
  compressedBytesReported?: number;
  now?: Date;
}

export interface AckClientLogNoDataCommand {
  auth: AuthContext;
  did: string;
  taskId: string;
  claimToken: string;
  now?: Date;
}

export class ClientLogUploadService {
  private readonly cryptoService: AesGcmPayloadCryptoService;

  constructor(
    private readonly database: ApplicationDatabase,
    keyResolver: ClientLogEncryptionKeyResolver,
    private readonly remoteLogPullService: AppRemoteLogPullService,
    private readonly options: {
      maxEncryptedPayloadBytes?: number;
      storageDir?: string;
    } = {},
  ) {
    this.cryptoService = new AesGcmPayloadCryptoService(keyResolver);
  }

  async getPolicy(auth: AuthContext): Promise<LogPolicyResult> {
    const settings = await this.remoteLogPullService.getCurrentConfig(auth.appId);
    return {
      enabled: settings.enabled,
      minPullIntervalSeconds: settings.minPullIntervalSeconds,
    };
  }

  async getPullTask(auth: AuthContext, did: string, now = new Date()): Promise<LogPullTaskResult> {
    const policy = await this.getPolicy(auth);
    if (!policy.enabled) {
      return {
        shouldUpload: false,
      };
    }

    const task = await this.claimPendingTask(auth, did, now);
    if (!task) {
      return {
        shouldUpload: false,
      };
    }

    return {
      shouldUpload: true,
      taskId: task.id,
      claimToken: task.claimToken as string,
      claimExpireAtMs: new Date(task.claimExpireAt as string).getTime(),
      fromTsMs: task.fromTsMs,
      toTsMs: task.toTsMs,
      maxLines: task.maxLines,
      maxBytes: task.maxBytes,
      keyId: task.keyId,
    };
  }

  async upload(command: UploadClientLogsCommand): Promise<LogUploadResult> {
    const now = command.now ?? new Date();
    const task = await this.requireClaimedTask(
      command.auth,
      command.did,
      command.taskId,
      command.claimToken,
      now,
    );

    if (command.encryption !== AES_256_GCM) {
      badRequest("LOG_UNSUPPORTED_ENCRYPTION", "X-Log-Enc must be aes-256-gcm.");
    }

    if (command.contentEncoding !== NDJSON_GZIP) {
      badRequest("REQ_INVALID_HEADER", "X-Log-Content must be ndjson+gzip.");
    }

    if (command.keyId !== task.keyId) {
      badRequest("LOG_TASK_MISMATCH", "X-Log-Key-Id does not match the claimed log upload task.");
    }

    const maxEncryptedPayloadBytes = this.options.maxEncryptedPayloadBytes ?? DEFAULT_MAX_ENCRYPTED_PAYLOAD_BYTES;
    if (command.body.length > maxEncryptedPayloadBytes) {
      payloadTooLarge("LOG_PAYLOAD_TOO_LARGE", "Encrypted log payload exceeds the allowed size.");
    }

    const compressed = await this.decryptPayload(command);
    const ndjsonBuffer = this.decompressPayload(compressed);
    const parsedLines = this.parseNdjson(ndjsonBuffer);
    const evaluated = this.evaluateLines(parsedLines, task);
    const uploadedAt = now.toISOString();
    const savedFile = await this.persistTaskFile(task, ndjsonBuffer, parsedLines.length);

    const uploadRecord: ClientLogUploadRecord = {
      id: randomId("log_upload"),
      taskId: task.id,
      appId: command.auth.appId,
      userId: command.auth.userId,
      keyId: command.keyId,
      encryption: AES_256_GCM,
      contentEncoding: NDJSON_GZIP,
      nonceBase64: command.nonceBase64,
      lineCountReported: command.lineCountReported,
      plainBytesReported: command.plainBytesReported,
      compressedBytesReported: command.compressedBytesReported,
      encryptedBytes: command.body.length,
      acceptedCount: evaluated.accepted.length,
      rejectedCount: evaluated.rejectedCount,
      uploadedAt,
    };

    await this.database.updateClientLogUploadTask(task.id, {
      status: "COMPLETED",
      claimToken: undefined,
      claimExpireAt: undefined,
      uploadedAt,
      uploadedFileName: savedFile.fileName,
      uploadedFilePath: savedFile.filePath,
      uploadedFileSizeBytes: savedFile.sizeBytes,
      uploadedLineCount: savedFile.lineCount,
    });

    return {
      taskId: task.id,
      acceptedCount: uploadRecord.acceptedCount,
      rejectedCount: uploadRecord.rejectedCount,
    };
  }

  async acknowledgeNoData(command: AckClientLogNoDataCommand): Promise<LogNoDataAckResult> {
    const now = command.now ?? new Date();
    const task = await this.requireClaimedTask(
      command.auth,
      command.did,
      command.taskId,
      command.claimToken,
      now,
    );

    await this.database.updateClientLogUploadTask(task.id, {
      status: "COMPLETED",
      claimToken: undefined,
      claimExpireAt: undefined,
    });

    return {
      taskId: task.id,
      status: "no_data",
    };
  }

  async fail(command: LogFailCommand): Promise<LogFailResult> {
    const now = command.now ?? new Date();
    const task = await this.requireClaimedTask(
      command.auth,
      command.did,
      command.taskId,
      command.claimToken,
      now,
    );

    const failureReason = [command.reason?.trim(), command.message?.trim()]
      .filter((item) => item && item.length > 0)
      .join(": ");
    const failedAt = now.toISOString();

    await this.database.updateClientLogUploadTask(task.id, {
      status: "FAILED",
      claimToken: undefined,
      claimExpireAt: undefined,
      failedAt,
      failureReason: failureReason || undefined,
    });

    return {
      taskId: task.id,
      status: "failed",
      failedAt,
      failureReason: failureReason || undefined,
    };
  }

  private async claimPendingTask(
    auth: AuthContext,
    did: string,
    now: Date,
  ): Promise<ClientLogUploadTaskRecord | undefined> {
    const candidate = (await this.database.listClientLogUploadTasks(auth.appId))
      .filter((item) => this.isTaskClaimableByClient(item, auth, did, now))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .at(0);
    if (!candidate) {
      return undefined;
    }

    const claimExpireAt = new Date(
      now.getTime() + (await this.remoteLogPullService.getCurrentConfig(auth.appId)).claimTtlSeconds * 1000,
    ).toISOString();
    const claimToken = randomId("log_claim");

    await this.database.updateClientLogUploadTask(candidate.id, {
      status: "CLAIMED",
      did,
      claimToken,
      claimExpireAt,
    });

    return {
      ...candidate,
      status: "CLAIMED",
      did,
      claimToken,
      claimExpireAt,
    };
  }

  private async requireClaimedTask(
    auth: AuthContext,
    did: string,
    taskId: string,
    claimToken: string,
    now: Date,
  ): Promise<ClientLogUploadTaskRecord> {
    const task = await this.database.findClientLogUploadTask(taskId);
    if (!task || task.appId !== auth.appId || (task.userId && task.userId !== auth.userId)) {
      badRequest("LOG_TASK_MISMATCH", "The log upload task is missing, expired, or no longer available.");
    }

    if (task.expiresAt && new Date(task.expiresAt).getTime() <= now.getTime()) {
      badRequest("LOG_TASK_MISMATCH", "The log upload task is missing, expired, or no longer available.");
    }

    if (task.status === "COMPLETED") {
      conflict("LOG_TASK_ALREADY_COMPLETED", "The log upload task is already completed.");
    }

    if (task.status === "FAILED") {
      badRequest("LOG_TASK_MISMATCH", "The log upload task is missing, expired, or no longer available.");
    }

    if (task.status === "CANCELLED") {
      badRequest("LOG_TASK_MISMATCH", "The log upload task is missing, expired, or no longer available.");
    }

    if (task.status !== "CLAIMED" || task.did !== did || task.claimToken !== claimToken) {
      conflict("LOG_CLAIM_MISMATCH", "The log upload claim is missing or no longer owned by this client.");
    }

    if (!task.claimExpireAt || new Date(task.claimExpireAt).getTime() <= now.getTime()) {
      conflict("LOG_CLAIM_EXPIRED", "The log upload claim has expired. Pull the task again before retrying.");
    }

    return task;
  }

  private isTaskClaimableByClient(
    task: ClientLogUploadTaskRecord,
    auth: AuthContext,
    did: string,
    now: Date,
  ): boolean {
    if (task.appId !== auth.appId) {
      return false;
    }

    if (task.userId && task.userId !== auth.userId) {
      return false;
    }

    if (task.did && task.did !== did) {
      return false;
    }

    if (task.expiresAt && new Date(task.expiresAt).getTime() <= now.getTime()) {
      return false;
    }

    if (task.status === "PENDING") {
      return true;
    }

    if (task.status !== "CLAIMED") {
      return false;
    }

    if (!task.claimExpireAt) {
      return true;
    }

    return new Date(task.claimExpireAt).getTime() <= now.getTime();
  }

  private async persistTaskFile(
    task: ClientLogUploadTaskRecord,
    ndjsonBuffer: Buffer,
    lineCount: number,
  ): Promise<{ fileName: string; filePath: string; sizeBytes: number; lineCount: number }> {
    const storageRoot = resolve(this.options.storageDir ?? DEFAULT_LOG_UPLOAD_STORAGE_DIR);
    const appDir = join(storageRoot, task.appId);
    await mkdir(appDir, { recursive: true });
    const fileName = `${task.id}.ndjson`;
    const filePath = join(appDir, fileName);
    await writeFile(filePath, ndjsonBuffer);
    return {
      fileName,
      filePath,
      sizeBytes: ndjsonBuffer.length,
      lineCount,
    };
  }

  private async decryptPayload(command: UploadClientLogsCommand): Promise<Buffer> {
    try {
      return await this.cryptoService.decrypt({
        algorithm: command.encryption,
        keyId: command.keyId,
        nonceBase64: command.nonceBase64,
        ciphertext: command.body,
      });
    } catch (error) {
      this.mapCryptoError(error);
    }
  }

  private mapCryptoError(error: unknown): never {
    if (!(error instanceof AesGcmPayloadCryptoError)) {
      throw error;
    }

    switch (error.code) {
      case "UNSUPPORTED_ALGORITHM":
        badRequest("LOG_UNSUPPORTED_ENCRYPTION", "X-Log-Enc must be aes-256-gcm.");
      case "INVALID_NONCE":
        badRequest("REQ_INVALID_HEADER", "X-Log-Nonce must decode to 12 bytes.");
      case "PAYLOAD_TOO_SMALL":
        badRequest("REQ_INVALID_BODY", "Encrypted log payload is too small.");
      case "UNKNOWN_KEY":
      case "DECRYPT_FAILED":
      case "ENCRYPT_FAILED":
      case "INVALID_ENVELOPE":
        badRequest("LOG_DECRYPT_FAILED", "Unable to decrypt the log payload.");
    }
  }

  private decompressPayload(compressed: Buffer): Buffer {
    try {
      return gunzipSync(compressed);
    } catch {
      badRequest("LOG_DECOMPRESS_FAILED", "Unable to gunzip the decrypted log payload.");
    }
  }

  private parseNdjson(buffer: Buffer): Array<{ payload: Record<string, unknown>; lineBytes: number }> {
    const text = buffer.toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    return lines.map((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        badRequest("LOG_INVALID_NDJSON", "NDJSON payload contains an invalid JSON line.");
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        badRequest("LOG_INVALID_NDJSON", "Each NDJSON line must be a JSON object.");
      }

      return {
        payload: parsed as Record<string, unknown>,
        lineBytes: Buffer.byteLength(line, "utf8"),
      };
    });
  }

  private evaluateLines(
    lines: Array<{ payload: Record<string, unknown>; lineBytes: number }>,
    task: ClientLogUploadTaskRecord,
  ): {
    accepted: Array<{
      payload: Record<string, unknown>;
      timestampMs?: number;
      level?: string;
      message?: string;
    }>;
    rejectedCount: number;
  } {
    const accepted: Array<{
      payload: Record<string, unknown>;
      timestampMs?: number;
      level?: string;
      message?: string;
    }> = [];
    let rejectedCount = 0;
    let acceptedBytes = 0;

    for (const line of lines) {
      const timestampMs = this.extractTimestampMs(line.payload);
      const withinWindow = this.isWithinTaskWindow(timestampMs, task);
      const nextLineCount = accepted.length + 1;
      const nextBytes = acceptedBytes + line.lineBytes;
      const withinLineLimit = task.maxLines === undefined || nextLineCount <= task.maxLines;
      const withinByteLimit = task.maxBytes === undefined || nextBytes <= task.maxBytes;

      if (!withinWindow || !withinLineLimit || !withinByteLimit) {
        rejectedCount += 1;
        continue;
      }

      accepted.push({
        payload: line.payload,
        timestampMs,
        level: typeof line.payload.level === "string" ? line.payload.level : undefined,
        message: typeof line.payload.message === "string" ? line.payload.message : undefined,
      });
      acceptedBytes = nextBytes;
    }

    return {
      accepted,
      rejectedCount,
    };
  }

  private isWithinTaskWindow(timestampMs: number | undefined, task: ClientLogUploadTaskRecord): boolean {
    if (task.fromTsMs === undefined && task.toTsMs === undefined) {
      return true;
    }

    if (timestampMs === undefined) {
      return false;
    }

    if (task.fromTsMs !== undefined && timestampMs < task.fromTsMs) {
      return false;
    }

    if (task.toTsMs !== undefined && timestampMs > task.toTsMs) {
      return false;
    }

    return true;
  }

  private extractTimestampMs(payload: Record<string, unknown>): number | undefined {
    const candidates = [payload.tsMs, payload.timestamp, payload.occurredAt, payload.time];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }

      if (typeof candidate === "string" && candidate.trim()) {
        const asNumber = Number(candidate);
        if (Number.isFinite(asNumber)) {
          return asNumber;
        }

        const parsed = Date.parse(candidate);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }
}
