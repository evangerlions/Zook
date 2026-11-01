import type {
  AdminAiNovelModelPointPricingDocument,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const BASE_PATH = "/api/v1/admin/apps/ai_novel/model-point-pricing";
const REVISION_PATH =
  /^\/api\/v1\/admin\/apps\/ai_novel\/model-point-pricing\/revisions\/(\d+)$/;
const RESTORE_PATH =
  /^\/api\/v1\/admin\/apps\/ai_novel\/model-point-pricing\/revisions\/(\d+)\/restore$/;

export async function tryHandleAdminAiNovelModelPointPricingRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === BASE_PATH) {
    return handleGet.call(this, request);
  }
  if (request.method === "PUT" && request.path === BASE_PATH) {
    return handleUpdate.call(this, request);
  }

  const revisionMatch = request.path.match(REVISION_PATH);
  if (request.method === "GET" && revisionMatch) {
    return handleGetRevision.call(this, request, Number(revisionMatch[1]));
  }
  const restoreMatch = request.path.match(RESTORE_PATH);
  if (request.method === "POST" && restoreMatch) {
    return handleRestore.call(this, request, Number(restoreMatch[1]));
  }
  return undefined;
}

async function handleGet(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminAiNovelModelPointPricingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiNovelModelPointPricing();
  await recordAudit.call(this, request, adminUser, "read", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleUpdate(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminAiNovelModelPointPricingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const result = await this.adminConsoleService.updateAiNovelModelPointPricing(
    body.config,
    this.validationPipe.optionalString(body, "desc"),
  );
  await recordAudit.call(this, request, adminUser, "update", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleGetRevision(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminAiNovelModelPointPricingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiNovelModelPointPricing(revision);
  await recordAudit.call(
    this,
    request,
    adminUser,
    "revision.read",
    `${result.configKey}:${revision}`,
    revision,
  );
  return this.ok(result, request.requestId as string);
}

async function handleRestore(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminAiNovelModelPointPricingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const result = await this.adminConsoleService.restoreAiNovelModelPointPricing(
    revision,
    this.validationPipe.optionalString(body, "desc"),
  );
  await recordAudit.call(
    this,
    request,
    adminUser,
    "restore",
    `${result.configKey}:${revision}`,
    revision,
  );
  return this.ok(result, request.requestId as string);
}

async function recordAudit(
  this: BackendRouteContext,
  request: HttpRequest,
  adminUser: string,
  action: string,
  resourceId: string,
  revision?: number,
): Promise<void> {
  await this.auditInterceptor.record({
    appId: "ai_novel",
    action: `admin.ai_novel_model_point_pricing.${action}`,
    resourceType: "app_config",
    resourceId,
    payload: { adminUser, ...(revision ? { revision } : {}) },
  });
}
