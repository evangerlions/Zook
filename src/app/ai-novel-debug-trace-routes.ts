import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import {
  AI_NOVEL_TRACE_KINDS,
  AI_NOVEL_TRACE_STATUSES,
  type AiNovelDebugTraceFilter,
  type AiNovelTraceStatus,
} from "../modules/ai-novel/ai-novel-debug-trace.service.ts";
import { buildAiNovelDebugTraceViewModel } from "../modules/ai-novel/ai-novel-debug-trace-view-model.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { shouldServeLocalDebugEndpoint } from "./encrypted-ai-routes.ts";

const TRACE_ROOT = "/api/v1/ai_novel/debug/traces";

export async function tryHandleAiNovelDebugTraceRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(TRACE_ROOT)) return undefined;
  if (!shouldServeLocalDebugEndpoint.call(this, request)) {
    throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Route not found.");
  }
  if (request.method === "GET" && isSharedDevRuntime()) {
    this.authenticateAdmin(request);
  }
  if (request.method === "POST" && request.path === TRACE_ROOT) {
    return await writeTrace.call(this, request);
  }
  if (request.method === "GET" && request.path === `${TRACE_ROOT}/data`) {
    return await listTraces.call(this, request);
  }
  const viewMatch = request.path.match(/^\/api\/v1\/ai_novel\/debug\/traces\/([^/]+)$/);
  if (request.method === "GET" && viewMatch) {
    return await viewTrace.call(this, request, viewMatch[1] ?? "");
  }
  throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Route not found.");
}

async function writeTrace(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const body = this.validationPipe.asObject(request.body);
  const sessionId = requiredText(body.sessionId, "sessionId");
  const kind = requiredEnum(body.kind, "kind", AI_NOVEL_TRACE_KINDS);
  const status = requiredEnum(body.status, "status", AI_NOVEL_TRACE_STATUSES);
  const trace = requiredObject(body.trace, "trace");
  const manifest = await this.aiNovelDebugTraceService.write({
    sessionId,
    uid: auth.userId,
    kind,
    status,
    ...(optionalText(body.bookId) ? { bookId: optionalText(body.bookId) } : {}),
    ...(optionalText(body.chapterId) ? { chapterId: optionalText(body.chapterId) } : {}),
    ...(optionalText(body.title) ? { title: optionalText(body.title) } : {}),
    trace,
  });
  return this.ok(
    {
      ...manifest,
    },
    request.requestId as string,
  );
}

async function listTraces(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const filter: AiNovelDebugTraceFilter = {
    ...(optionalText(request.query?.uid) ? { uid: optionalText(request.query?.uid) } : {}),
    ...(optionalText(request.query?.cid) ? { cid: optionalText(request.query?.cid) } : {}),
    ...(optionalEnum(request.query?.kind, AI_NOVEL_TRACE_KINDS) ? { kind: optionalEnum(request.query?.kind, AI_NOVEL_TRACE_KINDS) } : {}),
    ...(optionalEnum(request.query?.status, AI_NOVEL_TRACE_STATUSES) ? { status: optionalEnum(request.query?.status, AI_NOVEL_TRACE_STATUSES) } : {}),
    ...(optionalText(request.query?.bookId) ? { bookId: optionalText(request.query?.bookId) } : {}),
    ...(optionalText(request.query?.chapterId) ? { chapterId: optionalText(request.query?.chapterId) } : {}),
    ...(optionalText(request.query?.query) ? { query: optionalText(request.query?.query) } : {}),
  };
  return this.ok(
    { items: await this.aiNovelDebugTraceService.list(filter) },
    request.requestId as string,
  );
}

async function viewTrace(
  this: BackendRouteContext,
  request: HttpRequest,
  encodedSessionId: string,
): Promise<HttpResponse<unknown>> {
  try {
    const session = await this.aiNovelDebugTraceService.read(
      decodeURIComponent(encodedSessionId),
      optionalEnum(request.query?.kind, AI_NOVEL_TRACE_KINDS),
    );
    const sessions = await this.aiNovelDebugTraceService.list();
    return this.ok(
      {
        session,
        sessions,
        viewModel: buildAiNovelDebugTraceViewModel(session),
      },
      request.requestId as string,
    );
  } catch (error: unknown) {
    if (isMissingTrace(error)) {
      throw new ApplicationError(404, "TRACE_NOT_FOUND", "Trace session not found.");
    }
    throw error;
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (normalized) return normalized;
  throw new ApplicationError(400, "REQ_INVALID_BODY", `${field} is required.`);
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new ApplicationError(400, "REQ_INVALID_BODY", `${field} is required.`);
}

function requiredEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const normalized = optionalEnum(value, allowed);
  if (normalized) return normalized;
  throw new ApplicationError(400, "REQ_INVALID_BODY", `${field} is invalid.`);
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : undefined;
}

function isMissingTrace(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "ENOENT",
  );
}

function isSharedDevRuntime(): boolean {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  return appEnv === "dev" || appEnv === "development";
}
