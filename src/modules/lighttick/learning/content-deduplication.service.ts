import type { LightTickOwner } from "../lighttick.types.ts";
import { sha256 } from "../../shared/utils.ts";

interface ContentDocument {
  path: string;
  owner: LightTickOwner;
  moduleId?: string;
  hash: string;
  size: number;
  storage: "github" | "database" | "s3" | "archive";
  commitSha?: string;
  text?: string;
  compression?: "none" | "gzip" | "brotli";
  tier: "hot" | "warm" | "cold";
  lastAccessedAt?: string;
  updatedAt: string;
}

interface ContentRepository {
  getDocument(owner: LightTickOwner, path: string): Promise<ContentDocument | undefined>;
  getDocumentByHash(hash: string): Promise<ContentDocument | undefined>;
  saveDocument(doc: ContentDocument): Promise<void>;
  updateDocumentAccess(path: string, owner: LightTickOwner): Promise<void>;
  deleteDocument(path: string, owner: LightTickOwner): Promise<void>;
  listDocuments(owner: LightTickOwner, moduleId?: string): Promise<ContentDocument[]>;
  getContentStats(owner: LightTickOwner): Promise<{
    totalDocuments: number;
    totalSize: number;
    uniqueHashes: number;
    byStorage: Record<string, { count: number; size: number }>;
    byTier: Record<string, { count: number; size: number }>;
  }>;
}

export class ContentDeduplicationService {
  constructor(private readonly contentRepo: ContentRepository) {}

  async storeContent(
    owner: LightTickOwner,
    path: string,
    content: string,
    moduleId?: string,
    storage: "github" | "database" | "s3" = "database",
    commitSha?: string,
  ): Promise<{ hash: string; deduplicated: boolean; size: number }> {
    const hash = sha256(content);
    const size = Buffer.byteLength(content, "utf-8");

    const existing = await this.contentRepo.getDocumentByHash(hash);
    if (existing) {
      await this.contentRepo.updateDocumentAccess(path, owner);
      return { hash, deduplicated: true, size };
    }

    const doc: ContentDocument = {
      path,
      owner,
      moduleId,
      hash,
      size,
      storage,
      commitSha,
      text: storage === "database" ? content : undefined,
      compression: "none",
      tier: "warm",
      lastAccessedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.contentRepo.saveDocument(doc);
    return { hash, deduplicated: false, size };
  }

  async getContent(owner: LightTickOwner, path: string): Promise<string | undefined> {
    const doc = await this.contentRepo.getDocument(owner, path);
    if (!doc) return undefined;

    await this.contentRepo.updateDocumentAccess(path, owner);

    if (doc.storage === "database" && doc.text) {
      return doc.text;
    }

    return undefined;
  }

  async deleteContent(owner: LightTickOwner, path: string): Promise<void> {
    await this.contentRepo.deleteDocument(path, owner);
  }

  async listContent(owner: LightTickOwner, moduleId?: string): Promise<ContentDocument[]> {
    return this.contentRepo.listDocuments(owner, moduleId);
  }

  async getStats(owner: LightTickOwner) {
    return this.contentRepo.getContentStats(owner);
  }

  async archiveOldContent(
    owner: LightTickOwner,
    olderThanDays: number,
    maxItems?: number,
  ): Promise<{ archived: number; freedSize: number }> {
    const docs = await this.contentRepo.listDocuments(owner);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const toArchive = docs
      .filter((d) => d.tier !== "cold" && (!d.lastAccessedAt || new Date(d.lastAccessedAt) < cutoff))
      .slice(0, maxItems);

    let freedSize = 0;
    for (const doc of toArchive) {
      if (doc.text) {
        freedSize += Buffer.byteLength(doc.text, "utf-8");
      }
      doc.tier = "cold";
      doc.text = undefined;
      await this.contentRepo.saveDocument(doc);
    }

    return { archived: toArchive.length, freedSize };
  }

  async cleanupOrphanedContent(owner: LightTickOwner): Promise<{ deleted: number; freedSize: number }> {
    const docs = await this.contentRepo.listDocuments(owner);
    const orphaned = docs.filter((d) => !d.moduleId);

    let freedSize = 0;
    for (const doc of orphaned) {
      if (doc.text) {
        freedSize += Buffer.byteLength(doc.text, "utf-8");
      }
      await this.contentRepo.deleteDocument(doc.path, owner);
    }

    return { deleted: orphaned.length, freedSize };
  }
}
