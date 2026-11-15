import type { LightTickOwner } from "../lighttick.types.ts";
export type Tables = Record<string, Record<string, any>[]>;
export interface BackupSnapshot {
  schema: string;
  tables: Tables;
}
export interface BackupArchive {
  format: "lighttick-account-v1";
  id: string;
  owner: LightTickOwner;
  created_at: string;
  schema: string;
  tables: Tables;
  files: { storage_key: string; content: string; digest: string }[];
  digest: string;
  signature: string;
}
export interface BackupEntry extends LightTickOwner {
  id: string;
  kind: "export" | "preview" | "rollback";
  createdAt: string;
  data: Record<string, any>;
  summary: Record<string, any>;
}
export interface BackupStore {
  capture(o: LightTickOwner): Promise<BackupSnapshot>;
  replace(o: LightTickOwner, tables: Tables): Promise<number>;
  dryRun(
    o: LightTickOwner,
    tables: Tables,
    check: () => Promise<void>,
  ): Promise<void>;
  list(o: LightTickOwner): Promise<Omit<BackupEntry, "data">[]>;
  get(o: LightTickOwner, id: string): Promise<BackupEntry | undefined>;
  put(e: BackupEntry): Promise<void>;
  remove(o: LightTickOwner, id: string): Promise<void>;
  busy(o: LightTickOwner): Promise<boolean>;
}
export interface BackupFiles {
  read(o: LightTickOwner, key: string): Promise<string>;
  restore(o: LightTickOwner, key: string, content: string): Promise<string>;
}
