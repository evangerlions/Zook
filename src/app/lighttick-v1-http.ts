import type { LightTickServerEvent } from "../modules/lighttick/lighttick-analytics.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import { sha256 } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

type Json = Record<string, unknown>;
export function idempotencyKeyOf(request: HttpRequest): string {
  const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
  if (!key || key.length < 8 || key.length > 128)
    throw new ApplicationError(400, "REQ_FIELD_REQUIRED", "Idempotency-Key is required.");
  return key;
}


export function bodyOf(request: HttpRequest): Json {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Request body must be an object.");
  return request.body as Json;
}
export function numberOf(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new ApplicationError(400, "REQ_FIELD_REQUIRED", `${field} is required.`);
  return value as number;
}
export function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApplicationError(400, "REQ_FIELD_REQUIRED", `${field} is required.`);
  return value.trim();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function response(context: BackendRouteContext, request: HttpRequest, data: unknown, statusCode = 200) {
  const value = context.ok(data, request.requestId as string);
  value.statusCode = statusCode;
  if (statusCode === 201) { value.body.code = "CREATED"; value.body.message = "created"; }
  if (statusCode === 202) { value.body.code = "ACCEPTED"; value.body.message = "accepted"; }
  return value;
}
export function noStoreResponse(context: BackendRouteContext, request: HttpRequest, data: unknown, statusCode = 200) {
  const result = response(context, request, data, statusCode);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}

function analyticsPlatform(request: HttpRequest): "ios" | "android" | "web" {
  const bodyPlatform = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? (request.body as Json).platform : undefined;
  const value = bodyPlatform ?? request.headers["x-client-platform"] ?? request.headers["X-Client-Platform"];
  return value === "ios" || value === "android" ? value : "web";
}
export async function recordFact(runtime: LightTickRuntime, request: HttpRequest, userId: string, event: LightTickServerEvent,
  dedupeKey: string, pageKey: string, metadata: Json = {}) {
  try { await runtime.analytics?.record({ userId, event, dedupeKey, pageKey, platform: analyticsPlatform(request), metadata }); }
  catch { /* Product writes must not fail when ordinary analytics is unavailable. */ }
}
export async function idempotent<T>(runtime: LightTickRuntime, owner: LightTickOwner, request: HttpRequest,
  entityType: string, entityId: string, action: string, execute: () => Promise<T>): Promise<T> {
  const key = idempotencyKeyOf(request);
  const payload = bodyOf(request); const payloadHash = sha256(canonical(payload));
  return await runtime.repository.transaction(owner, async () => {
    await runtime.repository.lockPlanningOwner(owner);
    await runtime.scopePolicy.assertRequest(request);
    const existing = await runtime.repository.getOperation(owner, key);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.action !== action || existing.entityType !== entityType || existing.entityId !== entityId)
        throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
      return structuredClone(existing.resultPayload) as T;
    }
    const result = await execute(); const now = new Date().toISOString();
    const saved = await runtime.repository.saveOperation({ ...owner, operationId: key, deviceId: "http",
      payloadHash, entityType, entityId, action, requestPayload: payload,
      resultPayload: structuredClone(result) as Json, status: "accepted", createdAt: now, updatedAt: now });
    if (saved.payloadHash !== payloadHash || saved.action !== action || saved.entityType !== entityType || saved.entityId !== entityId)
      throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key collision.");
    return structuredClone(saved.resultPayload) as T;
  });
}
