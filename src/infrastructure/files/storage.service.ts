import { forbidden, badRequest } from "../../shared/errors.ts";
import type { FileConfirmResult, FilePresignResult } from "../../shared/types.ts";
import { randomId } from "../../shared/utils.ts";
import { ApplicationDatabase } from "../database/application-database.ts";

/**
 * StorageService models the documented presign -> confirm -> download authorization flow.
 */
export class StorageService {
  private readonly maxFileSizeBytes = 20 * 1024 * 1024;

  constructor(private readonly database: ApplicationDatabase) {}

  async presignUpload(command: {
    appId: string;
    ownerUserId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<FilePresignResult> {
    if (command.sizeBytes <= 0 || command.sizeBytes > this.maxFileSizeBytes) {
      badRequest("REQ_INVALID_BODY", "File size is outside the allowed range.");
    }

    const storageKey = `files/${command.appId}/${new Date().toISOString().slice(0, 10)}/${randomId(
      "file",
    )}-${command.fileName}`;

    await this.database.insertFile({
      id: randomId("db_file"),
      appId: command.appId,
      ownerUserId: command.ownerUserId,
      storageKey,
      mimeType: command.mimeType,
      sizeBytes: command.sizeBytes,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });

    return {
      uploadUrl: `https://storage.local/upload/${encodeURIComponent(storageKey)}`,
      storageKey,
      expireAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async confirmUpload(command: {
    appId: string;
    ownerUserId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<FileConfirmResult> {
    const fileRecord = await this.database.findFileByOwnerAndStorageKey(
      command.appId,
      command.ownerUserId,
      command.storageKey,
    );

    if (!fileRecord) {
      forbidden("FILE_ACCESS_DENIED", "File confirmation is not allowed for this owner.");
    }

    const confirmed = await this.database.confirmFile(fileRecord.id, command.mimeType, command.sizeBytes);
    if (!confirmed) {
      forbidden("FILE_ACCESS_DENIED", "File confirmation is not allowed for this owner.");
    }

    return {
      storageKey: confirmed.storageKey,
      downloadUrl: await this.getDownloadUrl(command.appId, command.ownerUserId, command.storageKey),
    };
  }

  async getDownloadUrl(appId: string, userId: string, storageKey: string): Promise<string> {
    const fileRecord = await this.database.findFileByAppAndStorageKey(appId, storageKey);

    if (!fileRecord || fileRecord.ownerUserId !== userId || fileRecord.status !== "CONFIRMED") {
      forbidden("FILE_ACCESS_DENIED", "File download is not allowed for this user.");
    }

    return `https://storage.local/download/${encodeURIComponent(storageKey)}?token=${randomId(
      "dl",
    )}`;
  }
}
