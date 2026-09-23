import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const RELEASE_UPDATE_ADMIN_PATH = "/api/v1/admin/apps/common/release-updates";

export async function tryHandleAdminReleaseUpdateRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === RELEASE_UPDATE_ADMIN_PATH) {
    return await handleAdminGetReleaseUpdates.call(this, request);
  }
  if (request.method === "PUT" && request.path === RELEASE_UPDATE_ADMIN_PATH) {
    return await handleAdminUpdateReleaseUpdates.call(this, request);
  }

  const revisionMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/common\/release-updates\/revisions\/(\d+)$/,
  );
  if (revisionMatch && request.method === "GET") {
    return await handleAdminGetReleaseUpdatesRevision.call(this, request, Number(revisionMatch[1]));
  }

  const restoreMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/common\/release-updates\/revisions\/(\d+)\/restore$/,
  );
  if (restoreMatch && request.method === "POST") {
    return await handleAdminRestoreReleaseUpdates.call(this, request, Number(restoreMatch[1]));
  }

  return undefined;
}

async function handleAdminGetReleaseUpdates(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getReleaseUpdateConfig();
  await recordAudit.call(this, request, adminUser, "admin.release_updates.read", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleAdminUpdateReleaseUpdates(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const config = body.config ?? body;
  const result = await this.adminConsoleService.updateReleaseUpdateConfig(config, desc);
  await recordAudit.call(this, request, adminUser, "admin.release_updates.update", result.configKey);
  return this.ok(result, request.requestId as string);
}

async function handleAdminGetReleaseUpdatesRevision(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getReleaseUpdateConfig(revision);
  await recordAudit.call(this, request, adminUser, "admin.release_updates.revision.read", `${result.configKey}:${revision}`);
  return this.ok(result, request.requestId as string);
}

async function handleAdminRestoreReleaseUpdates(
  this: BackendRouteContext,
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreReleaseUpdateConfig(revision, desc);
  await recordAudit.call(this, request, adminUser, "admin.release_updates.restore", `${result.configKey}:${revision}`);
  return this.ok(result, request.requestId as string);
}

async function recordAudit(
  this: BackendRouteContext,
  request: HttpRequest,
  adminUser: string,
  action: string,
  resourceId: string,
): Promise<void> {
  await this.auditInterceptor.record({
    appId: "common",
    action,
    resourceType: "app_config",
    resourceId,
    payload: { adminUser, requestId: request.requestId },
  });
}
