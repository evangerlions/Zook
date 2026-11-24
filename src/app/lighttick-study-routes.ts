import { ManualPlanningService } from "../modules/lighttick/manual/manual-planning.service.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import { LightTickStudyNotesService, NOTE_KINDS, type NoteKind } from "../modules/lighttick/lighttick-study-notes.service.ts";
import { LightTickStudyMaterialsService, type MaterialModule } from "../modules/lighttick/lighttick-study-materials.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import { bodyOf, idempotent } from "./lighttick-v1-http.ts";

function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
  return value.trim();
}

function intOf(value: unknown, field: string, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || (min !== undefined && n < min) || (max !== undefined && n > max))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", `${field} is outside the supported integer range.`);
  return n;
}

export async function handleStudyNotesRequest(
  runtime: LightTickRuntime,
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
): Promise<unknown | undefined> {
  const service = new LightTickStudyNotesService(runtime.repository);
  const prefix = "/api/v1/lighttick/study-notes";

  // GET /api/v1/lighttick/study-notes?q=xxx&kind=xxx&page=1&page_size=20
  if (request.method === "GET" && request.path === prefix) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    if (query.kind !== undefined && !NOTE_KINDS.includes(query.kind as NoteKind))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "kind is invalid.");
    return await service.list(owner, {
      q: query.q,
      kind: query.kind as NoteKind | undefined,
      page: query.page ? intOf(query.page, "page", 1, 2147483647) : 1,
      page_size: query.page_size ? intOf(query.page_size, "page_size", 1, 100) : 20,
    });
  }

  // PUT /api/v1/lighttick/study-notes/:kind/:courseId
  const putMatch = request.path.match(/^\/api\/v1\/lighttick\/study-notes\/([a-zA-Z_-]+)\/(.+)$/);
  if (putMatch && request.method === "PUT") {
    const body = bodyOf(request);
    const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"] ?? body.key;
    if (typeof key !== "string" || (body.key !== undefined && body.key !== key) ||
        typeof body.notes !== "string" || typeof body.base_revision !== "number")
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Invalid study note data or idempotency key.");
    const courseId = decodeURIComponent(putMatch[2]);
    const input = {
      kind: putMatch[1] as NoteKind, course_id: courseId, notes: body.notes,
      answers: (body.answers === undefined ? {} : body.answers) as Record<string, string>, base_revision: body.base_revision, key,
    };
    return await idempotent(runtime, owner, { ...request, headers: { ...request.headers, "idempotency-key": key } },
      "study_note", putMatch[1] + "/" + courseId, "save", async () => {
        await authorize();
        return service.save(owner, input);
      });
  }

  // GET /api/v1/lighttick/study-notes/:kind/:courseId
  const getMatch = request.path.match(/^\/api\/v1\/lighttick\/study-notes\/([a-zA-Z_-]+)\/(.+)$/);
  if (getMatch && request.method === "GET") {
    return await service.get(owner, getMatch[1] as NoteKind, decodeURIComponent(getMatch[2])) ?? null;
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
