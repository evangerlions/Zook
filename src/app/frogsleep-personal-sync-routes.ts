import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { asBody, authenticateFrogSleepRequest, frogSleepOk } from "./frogsleep-v1-common.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import { getHeader } from "../shared/utils.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { parsePaginationParams } from "../modules/frogsleep/frogsleep-validation.ts";
import { PersonalSyncService, type PersonalWriteOptions } from "../modules/frogsleep/personal-sync/personal-sync.service.ts";
import { sleepReportDocument, reportPayload } from "../modules/frogsleep/personal-sync/personal-report.ts";

function options(request: HttpRequest): PersonalWriteOptions {
  const match = getHeader(request.headers, "if-match");
  if (match !== undefined && !/^\d+$|^"\d+"$/.test(match)) badRequest("REQ_INVALID_HEADER", "If-Match must be a numeric revision.");
  const revision = match === undefined ? undefined : Number(match.replaceAll('"', ''));
  if (revision !== undefined && !Number.isSafeInteger(revision)) badRequest("REQ_INVALID_HEADER", "Invalid revision.");
  return { epoch: getHeader(request.headers, "x-sync-epoch"), operationKey: getHeader(request.headers, "idempotency-key"), expectedRevision: revision };
}
function rejectOwner(body: Record<string, unknown>) {
  if (["owner", "owner_id", "owner_user_id", "ownerUserId", "user_id", "userId", "app_id", "appId"].some(k => k in body)) badRequest("REQ_INVALID_BODY", "Resource scope comes from the authenticated account.");
}
/** Canonical private sync endpoints; all resource and cursor operations bind to the authenticated user. */
export async function tryHandlePersonalSyncRoutes(context: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const report = request.path.match(/^\/v1\/product-data\/sleep-reports(?:\/([^/]+))?$/);
  const sync = request.path.match(/^\/v1\/product-data\/personal-sync\/(state|restore|changes)$/);
  const preferences = request.path === "/v1/product-data/progress/report_preferences";
  if (!report && !sync && !preferences) return undefined;
  const auth = await authenticateFrogSleepRequest(context, request);
  const service = new PersonalSyncService(context.getPersonalSyncRepository());
  if (request.method === "GET" && sync) {
    const params = parsePaginationParams(request.query);
    const result = sync[1] === "state" ? await service.state(auth.userId) : await service.page(auth.userId, sync[1] as "restore" | "changes", params.limit, params.cursor);
    return frogSleepOk(context, result, request.requestId!);
  }
  if (request.method === "GET" && report && !report[1]) {
    const params = parsePaginationParams(request.query);
    const page = await service.browse(auth.userId, params.limit, params.cursor);
    const rows = page.items.filter(r => !r.deleted).map(r => sleepReportDocument({ ...r, sync_epoch: page.sync_epoch }));
    return frogSleepOk(context, { ...page, items: undefined, sleep_reports: rows, reports: rows }, request.requestId!);
  }
  const id = preferences ? "report_preferences" : report?.[1] ? decodeURIComponent(report[1]) : undefined;
  const kind = preferences ? "report_preferences" : "sleep_report";
  if (request.method === "GET" && id) {
    let row;
    try { row = await service.get(auth.userId, kind, id); }
    catch (error) {
      if (preferences && error instanceof ApplicationError && error.statusCode === 404) return frogSleepOk(context, { progress: null }, request.requestId!);
      throw error;
    }
    return frogSleepOk(context, preferences ? { progress: { ...row.data, id: row.id, revision: row.revision, sync_epoch: row.sync_epoch } } : sleepReportDocument(row), request.requestId!);
  }
  if (request.method === "DELETE" && id) return frogSleepOk(context, await service.write(auth.userId, kind, id, {}, true, options(request)), request.requestId!);
  if ((request.method === "POST" && report && !id) || (request.method === "PUT" || request.method === "PATCH") && id) {
    const body = asBody(request); rejectOwner(body);
    if (preferences) context.requireValidPublicContract(PublicContractValidator.validateFrogSleepProgressSnapshot(body), request);
    else context.requireValidPublicContract(PublicContractValidator.validateFrogSleepSleepReport(body), request);
    const payload: Record<string, unknown> = preferences ? { namespace: "report_preferences", schema_version: body.schema_version ?? body.version, state: body.state ?? body.data } : reportPayload(body);
    const logicalId = id ?? String(payload.snapshot_id);
    if (!preferences && id && id !== payload.snapshot_id) badRequest("REQ_INVALID_BODY", "Path ID and snapshot_id must match.");
    const row = await service.write(auth.userId, kind, logicalId, payload, false, options(request));
    return frogSleepOk(context, preferences ? { ...row.data, id: row.id, revision: row.revision, sync_epoch: row.sync_epoch } : sleepReportDocument(row), request.requestId!);
  }
  return undefined;
}
