import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { badRequest } from "../shared/errors.ts";
import { frogSleepAdminResources, type FrogSleepAdminResource } from "../modules/frogsleep/admin/frogsleep-admin.types.ts";
import { personalSyncCapabilities } from "../modules/frogsleep/personal-sync/personal-sync.service.ts";
import { resolveBuddyGrowthCapabilities } from "../modules/frogsleep/buddy-growth/buddy-growth-capabilities.ts";
import { asBody } from "./frogsleep-v1-common.ts";

const prefix = "/api/v1/admin/apps/frogsleep";
function positiveInteger(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) badRequest("REQ_INVALID_QUERY", "Invalid page or limit.");
  return parsed;
}
function boundedString(value: unknown) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 200) badRequest("REQ_INVALID_QUERY", "Invalid filter.");
  return value.trim() || undefined;
}
/** Sleep administrator routes use session and sensitive-operation authorization before data access. */
export async function tryHandleFrogSleepAdminRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(`${prefix}/`)) return undefined;
  const known = request.path === `${prefix}/operations` || /^\/api\/v1\/admin\/apps\/frogsleep\/(?:records\/[^/]+|notifications\/[^/]+\/retry)$/.test(request.path);
  if (!known) return undefined;
  const session = this.requireAdminSession(request);
  if (request.method === "GET" && request.path === `${prefix}/operations`) {
    const metrics = await this.getFrogSleepAdminStore().summary();
    await this.recordAdminReadAudit(session.username, "frogsleep.operations.read", "app_operations", "frogsleep", request.requestId);
    return this.ok({ app_id: "frogsleep", metrics, capabilities: { ...resolveBuddyGrowthCapabilities(), personalSyncRead: personalSyncCapabilities().read, personalSyncWrite: personalSyncCapabilities().write }, privacy: { aggregates_only: true, private_payload_visible: false } }, request.requestId!);
  }
  const records = request.path.match(/^\/api\/v1\/admin\/apps\/frogsleep\/records\/([^/]+)$/);
  if (request.method === "GET" && records) {
    await this.assertAdminSensitiveOperation(session, "frogsleep.records.read");
    if (!frogSleepAdminResources.includes(records[1] as FrogSleepAdminResource)) badRequest("REQ_INVALID_QUERY", "Unsupported resource.");
    const page = await this.getFrogSleepAdminStore().search({ resource: records[1] as FrogSleepAdminResource,
      page: positiveInteger(request.query?.page, 1, 1_000_000), limit: positiveInteger(request.query?.limit, 25, 100),
      userId: boundedString(request.query?.user_id), status: boundedString(request.query?.status) });
    await this.recordAdminReadAudit(session.username, `frogsleep.${records[1]}.read`, "operational_metadata", "frogsleep", request.requestId, "metadata_only");
    return this.ok({ app_id: "frogsleep", ...page, privacy: { user_level: true, private_payload_visible: false } }, request.requestId!);
  }
  const action = request.path.match(/^\/api\/v1\/admin\/apps\/frogsleep\/notifications\/([^/]+)\/retry$/);
  if (request.method === "POST" && action) {
    await this.assertAdminSensitiveOperation(session, "frogsleep.notifications.retry");
    return this.ok(await this.retryFrogSleepAdminNotification({ id: decodeURIComponent(action[1]), adminUser: session.username, reason: asBody(request).reason, requestId: request.requestId }), request.requestId!);
  }
  return undefined;
}
