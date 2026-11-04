import type { LightTickOwner } from "../lighttick.types.ts";
export type LearningWorkKind = "route_draft" | "lesson_draft" | "collect_sources" | "file_ingest";
export interface LearningSourceInput { kind: "text" | "file" | "url"; title: string; text?: string; storage_key?: string; url?: string }
export interface LearningSource { title: string; content: string; digest: string; source: { kind: "text" | "file" | "url"; storage_key?: string; url?: string } }
export interface LearningWork extends LightTickOwner {
  id: string; routeId: string; revision: number; kind: LearningWorkKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  epoch: number; baseRouteRevision: number; input: Record<string, any>; output: Record<string, any> | null;
  attempt: number; fence: string | null; leaseUntil: string | null; reservedMicros: number;
  errorCode: string | null; createdAt: string; updatedAt: string;
  adopted?: Record<string, any>;
}
export interface LearningWorkRepository {
  get(owner: LightTickOwner, id: string): Promise<LearningWork | undefined>;
  save(row: LearningWork, base: number): Promise<void>;
  list(owner: LightTickOwner, after: string, limit: number): Promise<LearningWork[]>;
  recent(owner: LightTickOwner, since: string): Promise<LearningWork[]>;
  recoverable(now: string, limit: number): Promise<LearningWork[]>;
}
