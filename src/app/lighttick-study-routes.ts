import { ManualPlanningService } from "../modules/lighttick/manual/manual-planning.service.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickStudyNotesService, type NoteKind } from "../modules/lighttick/lighttick-study-notes.service.ts";
import { LightTickStudyMaterialsService, type MaterialModule } from "../modules/lighttick/lighttick-study-materials.service.ts";

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

export async function handleStudyNotesRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
  assertActive: () => Promise<void> = async () => {},
): Promise<unknown | undefined> {
  const service = new LightTickStudyNotesService(repository);
  const prefix = "/api/v1/lighttick/study-notes";

  // GET /api/v1/lighttick/study-notes?q=xxx&kind=xxx&page=1&page_size=20
  if (request.method === "GET" && request.path === prefix) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return await service.list(owner, {
      q: query.q,
      kind: query.kind as NoteKind | undefined,
      page: query.page ? intOf(query.page, "page", 1) : 1,
      page_size: query.page_size ? intOf(query.page_size, "page_size", 1, 100) : 20,
    });
  }

  // PUT /api/v1/lighttick/study-notes/:kind/:courseId
  const putMatch = request.path.match(/^\/api\/v1\/lighttick\/study-notes\/([a-zA-Z_-]+)\/(.+)$/);
  if (putMatch && request.method === "PUT") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await new ManualPlanningService(repository, () => new Date(), assertActive).operation(owner, String(body.key ?? ""), "study-note:"+putMatch[1]+":"+putMatch[2], body, () => service.save(owner, {
      kind: putMatch[1] as NoteKind,
      course_id: decodeURIComponent(putMatch[2]),
      notes: stringOf(body.notes ?? "", "notes"),
      answers: (body.answers ?? {}) as Record<string, string>,
      base_revision: intOf(body.base_revision ?? 0, "base_revision", 0),
      key: stringOf(body.key ?? "", "key"),
    }));
  }

  // GET /api/v1/lighttick/study-notes/:kind/:courseId
  const getMatch = request.path.match(/^\/api\/v1\/lighttick\/study-notes\/([a-zA-Z_-]+)\/(.+)$/);
  if (getMatch && request.method === "GET") {
    return await service.get(owner, getMatch[1] as NoteKind, decodeURIComponent(getMatch[2]));
  }

  return undefined;
}

export async function handleStudyMaterialsRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const service = new LightTickStudyMaterialsService(repository);
  const prefix = "/api/v1/lighttick/study-materials";

  // GET /api/v1/lighttick/study-materials
  if (request.method === "GET" && request.path === prefix) {
    return await service.listModules(owner);
  }

  // GET /api/v1/lighttick/study-materials/learning-history?start=2026-01-01&end=2026-12-31
  if (request.method === "GET" && request.path === `${prefix}/learning-history`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return await service.getLearningHistory(owner,
      stringOf(query.start ?? "", "start"),
      stringOf(query.end ?? "", "end"));
  }

  // GET /api/v1/lighttick/study-materials/:module/:filename
  const lessonMatch = request.path.match(/^\/api\/v1\/lighttick\/study-materials\/([a-zA-Z_-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (lessonMatch && request.method === "GET") {
    return await service.getLesson(owner, lessonMatch[1] as MaterialModule, lessonMatch[2]);
  }

  // POST /api/v1/lighttick/study-materials/:module/:filename/learning-record
  const recordMatch = request.path.match(/^\/api\/v1\/lighttick\/study-materials\/([a-zA-Z_-]+)\/([a-zA-Z0-9_.-]+)\/learning-record$/);
  if (recordMatch && request.method === "POST") {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    return await service.saveLearningRecord(owner, {
      module_id: recordMatch[1] as MaterialModule,
      filename: recordMatch[2],
      summary_text: stringOf(body.summary_text ?? "", "summary_text"),
      time_spent_seconds: intOf(body.time_spent_seconds ?? 0, "time_spent_seconds", 0, 86400),
      base_revision: intOf(body.base_revision ?? 0, "base_revision", 0),
      key: stringOf(body.key ?? "", "key"),
    });
  }

  return undefined;
}
