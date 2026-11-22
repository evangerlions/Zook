import type { LightTickOwner } from "../lighttick.types.ts";
export type LearningWorkKind = "route_draft" | "route_refine" | "lesson_draft" | "collect_sources" | "file_ingest" | "report_review" | "tutor_turn" | "schedule_draft";
export function isRouteDraft(kind: LearningWorkKind) {
  return kind === "route_draft" || kind === "route_refine";
}
export function isPrivateLearningWork(kind: LearningWorkKind) {
  return kind === "report_review" || kind === "tutor_turn" || kind === "schedule_draft";
}
export interface LearningSourceInput { kind: "text" | "file" | "url"; title: string; text?: string; storage_key?: string; url?: string }
export interface LearningSource { title: string; content: string; digest: string; source: { kind: "text" | "file" | "url"; storage_key?: string; url?: string } }
export interface LearningWork extends LightTickOwner {
  id: string; routeId: string; revision: number; kind: LearningWorkKind;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  epoch: number; baseRouteRevision: number; input: Record<string, any>; output: Record<string, any> | null;
  attempt: number; fence: string | null; leaseUntil: string | null; reservedMicros: number;
  browserGenerationId?: string;
  errorCode: string | null; createdAt: string; updatedAt: string;
  adopted?: Record<string, any>;
}
export interface TutorObservation extends LightTickOwner {
  lessonId: string;
  routeId: string;
  routeVersion: number;
  goalId: string | null;
  goalScopeDigest: string;
  contentVersion: string;
  sourceDigest: string;
  publicationDigest: string;
  epoch: number;
  consentRevision: number;
  turnId: string;
  turnRevision: number;
  answerRevision: number;
  ruleVersion: number;
  revision: number;
  expiresAt: string;
  stopped: boolean;
  correction: string | null;
}
export interface LearningWorkRepository {
  get(owner: LightTickOwner, id: string): Promise<LearningWork | undefined>;
  save(row: LearningWork, base: number): Promise<void>;
  list(owner: LightTickOwner, after: string, limit: number): Promise<LearningWork[]>;
  reportAttempts(owner: LightTickOwner, lessonId: string, contentVersion: string): Promise<LearningWork[]>;
  tutorTurns(owner: LightTickOwner, lessonId: string, contentVersion: string): Promise<LearningWork[]>;
  tutorObservation(owner: LightTickOwner, lessonId: string): Promise<TutorObservation | undefined>;
  saveTutorObservation(row: TutorObservation, baseRevision: number): Promise<void>;
  recent(owner: LightTickOwner, since: string): Promise<LearningWork[]>;
  recoverable(now: string, limit: number): Promise<LearningWork[]>;
}
