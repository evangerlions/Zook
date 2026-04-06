import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { badRequest, conflict, payloadTooLarge } from "../shared/errors.ts";
import type {
  AuthContext,
  ClientLogLineRecord,
  ClientLogUploadRecord,
  ClientLogUploadTaskRecord,
  LogNoDataAckResult,
  LogPolicyResult,
  LogPullTaskResult,
  LogUploadResult,
} from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AppRemoteLogPullService } from "./app-remote-log-pull.service.ts";

const AES_256_GCM = "aes-256-gcm";
const NDJSON_GZIP = "ndjson+gzip";
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const DEFAULT_MAX_ENCRYPTED_PAYLOAD_BYTES = 8 * 1024 * 1024;
export interface ClientLogEncryptionKeyResolver {
  resolveKey(keyId: string): Promise<Buffer | undefined> | Buffer | undefined;
}

export class CompositeClientLogEncryptionKeyResolver implements ClientLogEncryptionKeyResolver {
  constructor(private readonly resolvers: ClientLogEncryptionKeyResolver[]) {}

  async resolveKey(keyId: string): Promise<Buffer | undefined> {
    for (const resolver of this.resolvers) {
      const resolved = await resolver.resolveKey(keyId);
      if (resolved) {
        return resolved;
      }
    }

    return undefined;
  }
}

export class StaticClientLogEncryptionKeyResolver implements ClientLogEncryptionKeyResolver {
  private readonly normalized = new Map<string, Buffer>();

  constructor(keys: Record<string, string> = {}) {
    for (const [keyId, secretBase64] of Object.entries(keys)) {
      const normalizedKeyId = keyId.trim();
      const normalizedSecret = secretBase64.trim();
      if (!normalizedKeyId || !normalizedSecret) {
        continue;
      }

      try {
        const key = Buffer.from(normalizedSecret, "base64");
        if (key.length === 32) {
          this.normalized.set(normalizedKeyId, key);
        }
      } catch {
        // Ignore invalid bootstrap keys and behave as if the key does not exist.
      }
    }
  }

  resolveKey(keyId: string): Buffer | undefined {
    return this.normalized.get(keyId.trim());
  }
}

export interface UploadClientLogsCommand {
  auth: AuthContext;
  clientId: string;
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
  clientId: string;
  taskId: string;
  claimToken: string;
  now?: Date;
}

export class ClientLogUploadService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly keyResolver: ClientLogEncryptionKeyResolver,
    private readonly remoteLogPullService: AppRemoteLogPullService,
    private readonly options: {
      maxEncryptedPayloadBytes?: number;
    } = {},
  ) {}

  async getPolicy(auth: AuthContext): Promise<LogPolicyResult> {
    const settings = await this.remoteLogPullService.getCurrentConfig(auth.appId);
    return {
      enabled: settings.enabled,
      minPullIntervalSeconds: settings.minPullIntervalSeconds,
    };
  }

  async getPullTask(auth: AuthContext, clientId: string, now = new Date()): Promise<LogPullTaskResult> {
    const policy = await this.getPolicy(auth);
    if (!policy.enabled) {
      return {
        shouldUpload: false,
      };
    }

    const task = await this.claimPendingTask(auth, clientId, now);
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
      command.clientId,
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

    const nonce = this.decodeNonce(command.nonceBase64);
    const key = await this.resolveKey(command.keyId);
    const compressed = this.decryptPayload(command.body, key, nonce);
    const ndjsonBuffer = this.decompressPayload(compressed);
    const parsedLines = this.parseNdjson(ndjsonBuffer);
    const evaluated = this.evaluateLines(parsedLines, task);
    const uploadedAt = now.toISOString();

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

    await this.database.insertClientLogUpload(uploadRecord);
    const acceptedLineRecords: ClientLogLineRecord[] = evaluated.accepted.map((item) => ({
      id: randomId("log_line"),
      uploadId: uploadRecord.id,
      taskId: task.id,
      appId: command.auth.appId,
      userId: command.auth.userId,
      timestampMs: item.timestampMs,
      level: item.level,
      message: item.message,
      payload: item.payload,
      createdAt: uploadedAt,
    }));
    await this.database.insertClientLogLines(acceptedLineRecords);

    await this.database.updateClientLogUploadTask(task.id, {
      status: "COMPLETED",
      claimToken: undefined,
      claimExpireAt: undefined,
      uploadedAt,
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
      command.clientId,
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

  private async claimPendingTask(
    auth: AuthContext,
    clientId: string,
    now: Date,
  ): Promise<ClientLogUploadTaskRecord | undefined> {
    const candidate = (await this.database.listClientLogUploadTasks(auth.appId))
      .filter((item) => this.isTaskClaimableByClient(item, auth, clientId, now))
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
      clientId,
      claimToken,
      claimExpireAt,
    });

    return {
      ...candidate,
      status: "CLAIMED",
      clientId,
      claimToken,
      claimExpireAt,
    };
  }

  private async requireClaimedTask(
    auth: AuthContext,
    clientId: string,
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

    if (task.status === "CANCELLED") {
      badRequest("LOG_TASK_MISMATCH", "The log upload task is missing, expired, or no longer available.");
    }

    if (task.status !== "CLAIMED" || task.clientId !== clientId || task.claimToken !== claimToken) {
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
    clientId: string,
    now: Date,
  ): boolean {
    if (task.appId !== auth.appId) {
      return false;
    }

    if (task.userId && task.userId !== auth.userId) {
      return false;
    }

    if (task.clientId && task.clientId !== clientId) {
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

  private decodeNonce(value: string): Buffer {
    let nonce: Buffer;
    try {
      nonce = Buffer.from(value, "base64");
    } catch {
      badRequest("REQ_INVALID_HEADER", "X-Log-Nonce must be valid base64.");
    }

    if (nonce.length !== GCM_NONCE_BYTES) {
      badRequest("REQ_INVALID_HEADER", "X-Log-Nonce must decode to 12 bytes.");
    }

    return nonce;
  }

  private async resolveKey(keyId: string): Promise<Buffer> {
    const resolved = await this.keyResolver.resolveKey(keyId);
    if (!resolved || resolved.length !== 32) {
      badRequest("LOG_DECRYPT_FAILED", "Unable to decrypt the log payload.");
    }

    return resolved;
  }

  private decryptPayload(body: Buffer, key: Buffer, nonce: Buffer): Buffer {
    if (body.length <= GCM_TAG_BYTES) {
      badRequest("REQ_INVALID_BODY", "Encrypted log payload is too small.");
    }

    const ciphertext = body.subarray(0, body.length - GCM_TAG_BYTES);
    const authTag = body.subarray(body.length - GCM_TAG_BYTES);

    try {
      const decipher = createDecipheriv(AES_256_GCM, key, nonce);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
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
