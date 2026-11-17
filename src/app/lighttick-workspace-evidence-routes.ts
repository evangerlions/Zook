import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickGoalWorkspaceService } from "../modules/lighttick/lighttick-goal-workspace.service.ts";
import { LightTickAiEvidenceService, type EvidenceKind } from "../modules/lighttick/lighttick-ai-evidence.service.ts";

function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
  return value.trim();
}

function intOf(value: unknown, field: string, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} must be an integer.`);
  if (min !== undefined && n < min) throw new Error(`${field} must be >= ${min}.`);
  if (max !== undefined && n > max) throw new Error(`${field} must be <= ${max}.`);
  return n;
}

export async function handleGoalWorkspaceRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const service = new LightTickGoalWorkspaceService(repository);
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/goals/workspace
  if (request.method === "GET" && request.path === `${prefix}/goals/workspace`) {
    return await service.get(owner);
  }

  // PUT /api/v1/lighttick/goals/:id/result
  const resultMatch = request.path.match(/^\/api\/v1\/lighttick\/goals\/([a-zA-Z0-9_-]+)\/result$/);
  if (resultMatch && request.method === "PUT") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await service.updateResult(owner, resultMatch[1], {
      mode: stringOf(body.mode, "mode") as any,
      target: body.target !== undefined ? intOf(body.target, "target", 0) : undefined,
      unit: body.unit !== undefined ? stringOf(body.unit, "unit") : undefined,
      note: body.note !== undefined ? stringOf(body.note, "note") : undefined,
    });
  }

  return undefined;
}

export async function handleAiEvidenceRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const service = new LightTickAiEvidenceService(repository);
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/ai/evidence?kind=xxx&limit=20
  if (request.method === "GET" && request.path === `${prefix}/ai/evidence`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return await service.list(owner, {
      kind: query.kind as EvidenceKind | undefined,
      limit: query.limit ? intOf(query.limit, "limit", 1, 100) : undefined,
    });
  }

  // GET /api/v1/lighttick/ai/evidence/:id
  const getMatch = request.path.match(/^\/api\/v1\/lighttick\/ai\/evidence\/([a-zA-Z0-9_-]+)$/);
  if (getMatch && request.method === "GET") {
    return await service.get(owner, getMatch[1]);
  }

  // POST /api/v1/lighttick/ai/evidence/feedback
  if (request.method === "POST" && request.path === `${prefix}/ai/evidence/feedback`) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await service.recordFeedback(owner, {
      snapshot_id: stringOf(body.snapshot_id, "snapshot_id"),
      useful: Boolean(body.useful),
      comment: body.comment !== undefined ? stringOf(body.comment, "comment") : undefined,
    });
  }

  // GET /api/v1/lighttick/ai/evidence/feedback
  if (request.method === "GET" && request.path === `${prefix}/ai/evidence/feedback`) {
    return await service.listFeedback(owner);
  }

  return undefined;
}
