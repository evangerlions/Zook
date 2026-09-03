import type {
  AdminAiNovelModelSelectionDocument,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const BASE_PATH = "/api/v1/admin/apps/ai_novel/model-selection";

export async function tryHandleAdminAiNovelModelSelectionRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === BASE_PATH) {
    return handleGetModelSelection.call(this, request);
  }
  if (request.method === "PUT" && request.path === BASE_PATH) {
    return handleUpdateModelSelection.call(this, request);
  }

  const revisionMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/model-selection\/revisions\/(\d+)$/,
  );
  if (request.method === "GET" && revisionMatch) {
    return handleGetModelSelectionRevision.call(
      this,
      request,
      Number(revisionMatch[1]),
    );
  }

  const restoreMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/model-selection\/revisions\/(\d+)\/restore$/,
  );
  if (request.method === "POST" && restoreMatch) {
    return handleRestoreModelSelection.call(
      this,
      request,
      Number(restoreMatch[1]),
    );
  }
  return undefined;
}

async function handleGetModelSelection(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminAiNovelModelSelectionDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiNovelModelSelection();
  await recordAudit.call(this, request, adminUser, "read", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleUpdateModelSelection(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminAiNovelModelSelectionDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const config = this.validationPipe.asObject(body.config);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateAiNovelModelSelection(
    config,
    desc,
  );
  await recordAudit.call(this, request, adminUser, "update", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleGetModelSelectionRevision(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminAiNovelModelSelectionDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result =
    await this.adminConsoleService.getAiNovelModelSelection(revision);
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

async function handleRestoreModelSelection(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminAiNovelModelSelectionDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreAiNovelModelSelection(
    revision,
    desc,
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
    action: `admin.ai_novel_model_selection.${action}`,
    resourceType: "app_config",
    resourceId,
    payload: { adminUser, ...(revision ? { revision } : {}) },
  });
}
