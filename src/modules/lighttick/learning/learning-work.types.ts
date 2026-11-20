import type { LightTickOwner } from "../lighttick.types.ts";
export type LearningWorkKind = "route_draft" | "lesson_draft" | "collect_sources" | "file_ingest" | "report_review" | "schedule_draft" | "tutor_turn";
export function isPrivateLearningWork(kind: LearningWorkKind) {
  return kind === "report_review" || kind === "schedule_draft" || kind === "tutor_turn";
}
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
export interface TutorObservation extends LightTickOwner {
  lessonId: string;
  routeId: string;
  goalId: string | null;
  contentVersion: string;
  sourceDigest: string;
  turnId: string;
  consentRevision: number;
  answerRevision: number;
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
  saveTutorObservation(row: TutorObservation, base: number): Promise<void>;
  recent(owner: LightTickOwner, since: string): Promise<LearningWork[]>;
  recoverable(now: string, limit: number, tutorOnly?: boolean): Promise<LearningWork[]>;
}
