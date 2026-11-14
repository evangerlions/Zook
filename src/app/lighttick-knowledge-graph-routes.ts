import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickKnowledgeGraphService } from "../modules/lighttick/knowledge/knowledge-graph.service.ts";
import { LightTickReflectionAssistService } from "../modules/lighttick/lighttick-reflection-assist.service.ts";

function intOf(value: unknown, field: string, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} must be an integer.`);
  if (min !== undefined && n < min) throw new Error(`${field} must be >= ${min}.`);
  if (max !== undefined && n > max) throw new Error(`${field} must be <= ${max}.`);
  return n;
}

export async function handleKnowledgeGraphRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/knowledge/graph?depth=3
  if (request.method === "GET" && request.path === `${prefix}/knowledge/graph`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const depth = query.depth ? intOf(query.depth, "depth", 1, 5) : 3;
    const service = new LightTickKnowledgeGraphService(repository);
    return await service.getGraph(owner, depth);
  }

  return undefined;
}

export async function handleReflectionAssistRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const prefix = "/api/v1/lighttick";

  // POST /api/v1/lighttick/reflections/assist
  if (request.method === "POST" && request.path === `${prefix}/reflections/assist`) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    const service = new LightTickReflectionAssistService(repository);
    const result = await service.assist(owner, {
      reflection_id: String(body.reflection_id),
      kind: body.kind === "clarify" ? "clarify" : body.kind === "organize" ? "organize" : undefined,
      text: String(body.text ?? ""),
    });
    return result;
  }

  // GET /api/v1/lighttick/reflections/assist/:id
  const getMatch = request.path.match(/^\/api\/v1\/lighttick\/reflections\/assist\/([a-zA-Z0-9_-]+)$/);
  if (getMatch && request.method === "GET") {
    const service = new LightTickReflectionAssistService(repository);
    return await service.getAttempt(owner, getMatch[1]);
  }

  return undefined;
}
