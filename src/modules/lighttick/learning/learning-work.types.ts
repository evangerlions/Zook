import type { LightTickOwner } from "../lighttick.types.ts";
export type LearningWorkKind = "route_draft" | "route_refine" | "lesson_draft" | "collect_sources" | "report_review" | "file_ingest" | "brief_intake" | "tutor_turn" | "schedule_draft";
export type LearningWorkPhase = "claimed" | "calling_model" | "validating" | "done" | "failed";
export interface LearningWorkProgress {
  phase: LearningWorkPhase;
  received_chars: number;
  lesson_count_so_far: number;
  updated_at: string;
}
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
  errorCode: string | null; createdAt: string; updatedAt: string;
  /**
   * 具体拒绝原因（校验器原话），只在失败时写。
   * 只落在 work 文档里供排障（`payload->>'errorMessage'`），不进对外响应：
   * 加进 API 会扩 OpenAPI 合同并牵动三端客户端，排障价值不值这个扩散面。
   */
  errorMessage?: string | null;
  /**
   * 盲解判定失败时的第一手诊断：`missing_conditions`、`item_flaws`、答案要点与
   * 蓝图要素缺口。理由同 `errorMessage`——只落 work 文档供排障
   * （`payload->'diagnostics'`），不进对外响应，也不扩 OpenAPI。
   * 没有它，失败课节只能看到「still unsolvable」，无法判断是蓝图缺素材还是正文没写。
   */
  diagnostics?: Record<string, any> | null;
  adopted?: Record<string, any>;
  /** Present when the row is owned by a browser-initiated generation; such rows are never dispatched to the worker. */
  browserGenerationId?: string | null;
  progress?: LearningWorkProgress | null;
}
export interface TaskSummary {
  id: string;
  type: LearningWorkKind;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: LearningWorkProgress | null;
  error?: { code: string; message: string } | null;
  resultRef?: { path: string; label: string } | null;
  retryRef?: { path: string; label: string } | null;
  createdAt: string;
  completedAt?: string | null;
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
  reportAttempts(owner: LightTickOwner, lessonId:string, version:string):Promise<LearningWork[]>;
  get(owner: LightTickOwner, id: string): Promise<LearningWork | undefined>;
  save(row: LearningWork, base: number): Promise<void>;
  /** Non-CAS phase update. Never touches revision, status, fence or lease. */
  progress(owner: LightTickOwner, id: string, fence: string, value: LearningWorkProgress): Promise<void>;
  list(owner: LightTickOwner, after: string, limit: number): Promise<LearningWork[]>;
  tutorTurns(owner: LightTickOwner, lessonId: string, contentVersion: string): Promise<LearningWork[]>;
  tutorObservation(owner: LightTickOwner, lessonId: string): Promise<TutorObservation | undefined>;
  saveTutorObservation(row: TutorObservation, baseRevision: number): Promise<void>;
  recent(owner: LightTickOwner, since: string): Promise<LearningWork[]>;
  recoverable(now: string, limit: number): Promise<LearningWork[]>;
}
