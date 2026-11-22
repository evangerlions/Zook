import type { LightTickOwner } from "../lighttick.types.ts";
export type LearningWorkKind = "route_draft" | "route_refine" | "lesson_draft" | "collect_sources" | "file_ingest" | "report_review";
export interface LearningSourceInput { kind: "text" | "file" | "url"; title: string; text?: string; storage_key?: string; url?: string }
export interface LearningSource { title: string; content: string; digest: string; source: { kind: "text" | "file" | "url"; storage_key?: string; url?: string } }
export interface LearningWorkProgress {
  phase: "claimed" | "calling_model" | "validating" | "done" | "failed";
  received_chars: number;
  lesson_count_so_far: number;
  updated_at: string;
}
export interface LearningWork extends LightTickOwner {
  id: string; routeId: string; revision: number; kind: LearningWorkKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  epoch: number; baseRouteRevision: number; input: Record<string, any>; output: Record<string, any> | null;
  attempt: number; fence: string | null; leaseUntil: string | null; reservedMicros: number;
  browserGenerationId?: string;
  progress?: LearningWorkProgress;
  errorCode: string | null; createdAt: string; updatedAt: string;
  adopted?: Record<string, any>;
}
export interface LearningWorkRepository {
  get(owner: LightTickOwner, id: string): Promise<LearningWork | undefined>;
  save(row: LearningWork, base: number): Promise<void>;
  list(owner: LightTickOwner, after: string, limit: number): Promise<LearningWork[]>;
  reportAttempts(owner: LightTickOwner, lessonId: string, contentVersion: string): Promise<LearningWork[]>;
  recent(owner: LightTickOwner, since: string): Promise<LearningWork[]>;
  recoverable(now: string, limit: number): Promise<LearningWork[]>;
}
