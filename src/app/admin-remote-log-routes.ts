import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";


export async function tryHandleAdminRemoteLogRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const settingsMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull$/);
  if (request.method === "GET" && settingsMatch) return await handleAdminGetRemoteLogPullSettings.call(this, request, decodeURIComponent(settingsMatch[1] as string));
  if (request.method === "PUT" && settingsMatch) return await handleAdminUpdateRemoteLogPullSettings.call(this, request, decodeURIComponent(settingsMatch[1] as string));
  const revisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/revisions\/(\d+)$/);
  if (request.method === "GET" && revisionMatch) return await handleAdminGetRemoteLogPullSettingsRevision.call(this, request, decodeURIComponent(revisionMatch[1] as string), Number(revisionMatch[2]));
  const restoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && restoreMatch) return await handleAdminRestoreRemoteLogPullSettingsRevision.call(this, request, decodeURIComponent(restoreMatch[1] as string), Number(restoreMatch[2]));
  const tasksMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks$/);
  if (request.method === "GET" && tasksMatch) return await handleAdminListRemoteLogPullTasks.call(this, request, decodeURIComponent(tasksMatch[1] as string));
  if (request.method === "POST" && tasksMatch) return await handleAdminCreateRemoteLogPullTask.call(this, request, decodeURIComponent(tasksMatch[1] as string));
  const cancelMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) return await handleAdminCancelRemoteLogPullTask.call(this, request, decodeURIComponent(cancelMatch[1] as string), decodeURIComponent(cancelMatch[2] as string));
  const fileMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)\/file$/);
  if (request.method === "GET" && fileMatch) return await handleAdminGetRemoteLogPullTaskFile.call(this, request, decodeURIComponent(fileMatch[1] as string), decodeURIComponent(fileMatch[2] as string));
  const detailMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) return await handleAdminGetRemoteLogPullTask.call(this, request, decodeURIComponent(detailMatch[1] as string), decodeURIComponent(detailMatch[2] as string));
  return undefined;
}

export async function handleAdminGetRemoteLogPullSettings(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result =
    await this.adminConsoleService.getRemoteLogPullSettings(appId);
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateRemoteLogPullSettings(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const config = body.config ?? body;
  const result = await this.adminConsoleService.updateRemoteLogPullSettings(
    appId,
    config,
    desc,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetRemoteLogPullSettingsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getRemoteLogPullSettings(
    appId,
    revision,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: { adminUser, revision },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreRemoteLogPullSettingsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreRemoteLogPullSettings(
    appId,
    revision,
    desc,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: { adminUser, revision },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminListRemoteLogPullTasks(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.listRemoteLogPullTasks(appId);
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.tasks.read",
    resourceType: "client_log_upload",
    resourceId: "task-list",
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminCreateRemoteLogPullTask(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.createRemoteLogPullTask(
    appId,
    this.validationPipe.asObject(request.body),
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.task.create",
    resourceType: "client_log_upload",
    resourceId: result.items[0]?.taskId ?? "created",
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminCancelRemoteLogPullTask(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  taskId: string,
): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.cancelRemoteLogPullTask(
    appId,
    taskId,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.task.cancel",
    resourceType: "client_log_upload",
    resourceId: taskId,
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetRemoteLogPullTaskFile(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  taskId: string,
): Promise<HttpResponse<AdminRemoteLogPullTaskFileDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getRemoteLogPullTaskFile(
    appId,
    taskId,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.task.file.read",
    resourceType: "client_log_upload",
    resourceId: taskId,
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetRemoteLogPullTask(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  taskId: string,
): Promise<HttpResponse<AdminRemoteLogPullTaskDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getRemoteLogPullTask(
    appId,
    taskId,
  );
  await this.auditInterceptor.record({
    appId,
    action: "admin.remote_log_pull.task.read",
    resourceType: "client_log_upload",
    resourceId: taskId,
    payload: { adminUser },
  });
  return this.ok(result, request.requestId as string);
}
