import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickBehaviorService, type BehaviorModule, VALID_MODULES } from "../modules/lighttick/lighttick-behavior.service.ts";

import { ApplicationError } from "../shared/errors.ts";
function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ApplicationError(400, "REQ_FIELD_REQUIRED", `${field} is required.`);
  return value.trim();
}

function moduleOf(value: unknown): BehaviorModule {
  const v = String(value).trim();
  if (!VALID_MODULES.includes(v as BehaviorModule))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", `module_id must be one of: ${VALID_MODULES.join(", ")}`);
  return v as BehaviorModule;
}

function intOf(value: unknown, field: string, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ApplicationError(400, "REQ_FIELD_INVALID", `${field} must be an integer.`);
  if (min !== undefined && n < min) throw new ApplicationError(400, "REQ_FIELD_INVALID", `${field} must be >= ${min}.`);
  if (max !== undefined && n > max) throw new ApplicationError(400, "REQ_FIELD_INVALID", `${field} must be <= ${max}.`);
  return n;
}

export async function handleBehaviorRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const service = new LightTickBehaviorService(repository);
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/behavior/applications
  if (request.method === "GET" && request.path === `${prefix}/behavior/applications`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return await service.list(owner, {
      date_from: query.date_from,
      date_to: query.date_to,
      module_id: query.module_id ? moduleOf(query.module_id) : undefined,
    });
  }

  // POST /api/v1/lighttick/behavior/applications
  if (request.method === "POST" && request.path === `${prefix}/behavior/applications`) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await service.create(owner, {
      date: stringOf(body.date, "date"),
      module_id: moduleOf(body.module_id),
      concept: stringOf(body.concept, "concept"),
      scenario: body.scenario !== undefined ? stringOf(body.scenario, "scenario") : undefined,
      effectiveness: body.effectiveness !== undefined ? intOf(body.effectiveness, "effectiveness", 0, 5) : undefined,
    });
  }

  // GET /api/v1/lighttick/behavior/applications/concepts
  if (request.method === "GET" && request.path === `${prefix}/behavior/applications/concepts`) {
    return await service.getDistinctConcepts(owner);
  }

  // GET /api/v1/lighttick/behavior/applications/:id
  const getMatch = request.path.match(/^\/api\/v1\/lighttick\/behavior\/applications\/([a-zA-Z0-9_-]+)$/);
  if (getMatch && request.method === "GET") {
    return await service.get(owner, getMatch[1]);
  }

  // PUT /api/v1/lighttick/behavior/applications/:id
  const putMatch = request.path.match(/^\/api\/v1\/lighttick\/behavior\/applications\/([a-zA-Z0-9_-]+)$/);
  if (putMatch && request.method === "PUT") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await service.update(owner, putMatch[1], {
      date: body.date !== undefined ? stringOf(body.date, "date") : undefined,
      module_id: body.module_id !== undefined ? moduleOf(body.module_id) : undefined,
      concept: body.concept !== undefined ? stringOf(body.concept, "concept") : undefined,
      scenario: body.scenario !== undefined ? stringOf(body.scenario, "scenario") : undefined,
      effectiveness: body.effectiveness !== undefined ? intOf(body.effectiveness, "effectiveness", 0, 5) : undefined,
    });
  }

  // DELETE /api/v1/lighttick/behavior/applications/:id
  const delMatch = request.path.match(/^\/api\/v1\/lighttick\/behavior\/applications\/([a-zA-Z0-9_-]+)$/);
  if (delMatch && request.method === "DELETE") {
    await service.delete(owner, delMatch[1]);
    return { deleted: true };
  }

  // GET /api/v1/lighttick/behavior/stats?period=30
  if (request.method === "GET" && request.path === `${prefix}/behavior/stats`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const period = query.period ? intOf(query.period, "period", 1, 365) : 30;
    return await service.getStats(owner, period);
  }

  return undefined;
}
