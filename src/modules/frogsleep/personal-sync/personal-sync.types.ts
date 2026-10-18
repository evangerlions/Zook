export type PersonalResourceKind = "sleep_report" | "report_preferences";
/** An immutable resource revision doubles as a committed change and restore history. */
export interface PersonalVersion {
  kind: PersonalResourceKind;
  id: string;
  revision: number;
  sequence: number;
  deleted: boolean;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface PersonalSyncState { epoch: string; cursorSecret: string; sequence: number; legacyAllowed: boolean; deleted: boolean }
export interface PersonalReceipt { digest: string; result: PersonalVersion }
/** Scoped unit of work; its account lock is held through database commit. */
export interface PersonalSyncTransaction {
  state: PersonalSyncState;
  current(kind: PersonalResourceKind, id: string): Promise<PersonalVersion | undefined>;
  receipt(key: string): Promise<PersonalReceipt | undefined>;
  saveReceipt(key: string, digest: string, result: PersonalVersion): Promise<void>;
  commit(version: PersonalVersion, key: string, digest: string): Promise<void>;
  browse(boundary: number, limit: number, after?: { time: string; id: string }): Promise<PersonalVersion[]>;
  page(mode: "restore" | "changes", boundary: number, after: number, limit: number, kind?: PersonalResourceKind): Promise<PersonalVersion[]>;
}
/** Account-scoped personal history; no buddy grants or private payload sharing. */
export interface PersonalSyncRepository {
  run<T>(userId: string, operation: (tx: PersonalSyncTransaction) => Promise<T>): Promise<T>;
}
