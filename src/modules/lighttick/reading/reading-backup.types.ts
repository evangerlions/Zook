import type { LightTickOwner } from "../lighttick.types.ts";
export const READING_BACKUP_SECTIONS = [
  "articles",
  "article_versions",
  "vocabulary",
  "vocabulary_reviews",
  "sources",
  "source_versions",
  "work",
  "work_assets",
  "preferences",
  "preference_versions",
  "schedule",
  "receipts",
] as const;
export type ReadingBackupSection = (typeof READING_BACKUP_SECTIONS)[number];
export interface ReadingBackupRecord {
  section: ReadingBackupSection;
  key: string;
  value: unknown;
}
export interface ReadingBackupPart {
  index: number;
  byte_length: number;
  sha256: string;
  data_base64: string;
}
export interface ReadingBackupManifest {
  id: string;
  revision: 1;
  format: "lighttick-reading-ndjson-v2";
  owner: { app_id: "lighttick"; user_id: string };
  created_at: string;
  expires_at: string;
  byte_length: number;
  record_count: number;
  counts: Record<ReadingBackupSection, number>;
  parts: Omit<ReadingBackupPart, "data_base64">[];
  content_sha256: string;
  manifest_sha256: string;
}
export interface ReadingBackupRepository {
  expiredOwners(now: string, limit: number): Promise<LightTickOwner[]>;
  entries(
    o: LightTickOwner,
    section: ReadingBackupSection,
    after: string,
    limit: number,
  ): Promise<ReadingBackupRecord[]>;
  list(o: LightTickOwner): Promise<ReadingBackupManifest[]>;
  get(
    o: LightTickOwner,
    id: string,
  ): Promise<ReadingBackupManifest | undefined>;
  part(
    o: LightTickOwner,
    id: string,
    index: number,
  ): Promise<ReadingBackupPart | undefined>;
  begin(o: LightTickOwner, id: string, expires: string): Promise<void>;
  savePart(
    o: LightTickOwner,
    id: string,
    part: ReadingBackupPart,
  ): Promise<void>;
  finish(o: LightTickOwner, manifest: ReadingBackupManifest): Promise<void>;
  delete(o: LightTickOwner, id: string): Promise<void>;
  prune(o: LightTickOwner, now: string): Promise<void>;
  invalidate(o: LightTickOwner): Promise<void>;
}
