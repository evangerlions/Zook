import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function tryHandleAiOutputReportingRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (
    request.method === "POST" &&
    request.path === "/api/v1/ai_novel/ai-output-reports"
  ) {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const result = await this.aiOutputReportingService.submitReport({
      auth,
      body: this.validationPipe.asObject(request.body),
      platform: getHeader(request.headers, "x-platform"),
      appVersion: getHeader(request.headers, "x-app-version"),
      locale: getHeader(request.headers, "x-app-locale"),
    });
    await this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "ai_output_report.submit",
      resourceType: "ai_output_report",
      resourceId: result.reportId,
      resourceOwnerUserId: auth.userId,
      payload: {},
    });
    return this.ok(result, request.requestId as string);
  }

  if (
    request.method === "POST" &&
    request.path === "/api/v1/ai_novel/ai-output-reactions"
  ) {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const result = await this.aiOutputReportingService.submitReaction({
      auth,
      body: this.validationPipe.asObject(request.body),
      platform: getHeader(request.headers, "x-platform"),
      appVersion: getHeader(request.headers, "x-app-version"),
    });
    return this.ok(result, request.requestId as string);
  }

  if (
    request.method === "GET" &&
    request.path === "/api/v1/admin/apps/ai_novel/ai-output-reports"
  ) {
    const admin = this.requireAdminSession(request);
    const result = await this.aiOutputReportingService.listReports({
      category: request.query?.category,
      status: request.query?.status,
      limit: request.query?.limit,
    });
    await this.auditInterceptor.record({
      appId: "ai_novel",
      action: "ai_output_report.admin_list",
      resourceType: "ai_output_report",
      payload: { admin: admin.username },
    });
    return this.ok(result, request.requestId as string);
  }

  const detailMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/ai-output-reports\/([^/]+)$/,
  );
  if (request.method === "GET" && detailMatch) {
    const admin = this.requireAdminSession(request);
    const reportId = decodeURIComponent(detailMatch[1] ?? "");
    const result = await this.aiOutputReportingService.getReport(reportId);
    await this.auditInterceptor.record({
      appId: "ai_novel",
      action: "ai_output_report.admin_read",
      resourceType: "ai_output_report",
      resourceId: reportId,
      payload: { admin: admin.username },
    });
    return this.ok(result, request.requestId as string);
  }

  const statusMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/ai-output-reports\/([^/]+)\/status$/,
  );
  if (request.method === "PATCH" && statusMatch) {
    const admin = this.requireAdminSession(request);
    const reportId = decodeURIComponent(statusMatch[1] ?? "");
    const result = await this.aiOutputReportingService.updateReportStatus(
      reportId,
      this.validationPipe.asObject(request.body),
    );
    await this.auditInterceptor.record({
      appId: "ai_novel",
      action: "ai_output_report.admin_status_update",
      resourceType: "ai_output_report",
      resourceId: reportId,
      payload: { admin: admin.username, status: result.status },
    });
    return this.ok(result, request.requestId as string);
  }

  return undefined;
}
