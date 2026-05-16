import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface AiNovelAuditFileWriteCommand {
  sessionId: string;
  html: string;
}

export interface AiNovelAuditFileDocument {
  filePath: string;
  fileUrl: string;
  viewUrl?: string;
  updatedAt: string;
}

const DEFAULT_AINOVEL_AUDIT_ROOT =
  "/Users/zhoukai/Projects/AI/codex1/AINovel/.zook/quality-generation/app";

export class AiNovelAuditFileService {
  constructor(private readonly rootPath = DEFAULT_AINOVEL_AUDIT_ROOT) {}

  async writeAuditFile(
    command: AiNovelAuditFileWriteCommand,
  ): Promise<AiNovelAuditFileDocument> {
    const safeSessionId = this.sanitizeSessionId(command.sessionId);
    const directory = join(this.rootPath, safeSessionId);
    const filePath = join(directory, "generation-audit.html");
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, command.html, "utf8");

    return {
      filePath,
      fileUrl: pathToFileURL(filePath).href,
      updatedAt: new Date().toISOString(),
    };
  }

  async readAuditFile(sessionId: string): Promise<string> {
    const safeSessionId = this.sanitizeSessionId(sessionId);
    return readFile(
      join(this.rootPath, safeSessionId, "generation-audit.html"),
      "utf8",
    );
  }

  sanitizeSessionId(sessionId: string): string {
    const trimmed = sessionId.trim();
    const normalized = trimmed
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[._-]+/, "")
      .replace(/[._-]+$/, "")
      .slice(0, 120);
    return normalized || "session";
  }
}
