import type {
  AdminTestAccountDocument,
  AdminTestAccountRevealDocument,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
import { TEST_ACCOUNT_CODE_REVEAL_OPERATION } from "../services/common-test-account.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function tryHandleAdminTestAccountRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/test-accounts") {
    return await handleAdminGetTestAccounts.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/test-accounts") {
    return await handleAdminCreateTestAccount.call(this, request);
  }
  const updateMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/test-accounts\/([^/]+)$/);
  if (request.method === "PUT" && updateMatch) {
    return await handleAdminUpdateTestAccount.call(this, request, decodeURIComponent(updateMatch[1]));
  }
  if (request.method === "DELETE" && updateMatch) {
    return await handleAdminDeleteTestAccount.call(this, request, decodeURIComponent(updateMatch[1]));
  }
  const resetMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/test-accounts\/([^/]+)\/reset-code$/);
  if (request.method === "POST" && resetMatch) {
    return await handleAdminResetTestAccountCode.call(this, request, decodeURIComponent(resetMatch[1]));
  }
  const revealMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/test-accounts\/([^/]+)\/reveal-code$/);
  if (request.method === "POST" && revealMatch) {
    return await handleAdminRevealTestAccountCode.call(this, request, decodeURIComponent(revealMatch[1]));
  }
  return undefined;
}

export async function handleAdminGetTestAccounts(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminTestAccountDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.commonTestAccountService.getDocument();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.read",
    resourceType: "test_account",
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminCreateTestAccount(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<AdminTestAccountDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.commonTestAccountService.create(
    this.validationPipe.asObject(request.body),
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.create",
    resourceType: "test_account",
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateTestAccount(
  this: BackendRouteContext,
  request: HttpRequest,
  accountId: string,
): Promise<HttpResponse<AdminTestAccountDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.commonTestAccountService.update(
    accountId,
    this.validationPipe.asObject(request.body),
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.update",
    resourceType: "test_account",
    resourceId: accountId,
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminDeleteTestAccount(
  this: BackendRouteContext,
  request: HttpRequest,
  accountId: string,
): Promise<HttpResponse<AdminTestAccountDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.commonTestAccountService.delete(accountId);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.delete",
    resourceType: "test_account",
    resourceId: accountId,
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminResetTestAccountCode(
  this: BackendRouteContext,
  request: HttpRequest,
  accountId: string,
): Promise<HttpResponse<AdminTestAccountDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.commonTestAccountService.resetCode(accountId);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.reset_code",
    resourceType: "test_account",
    resourceId: accountId,
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRevealTestAccountCode(
  this: BackendRouteContext,
  request: HttpRequest,
  accountId: string,
): Promise<HttpResponse<AdminTestAccountRevealDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    TEST_ACCOUNT_CODE_REVEAL_OPERATION,
  );
  const result = await this.commonTestAccountService.revealCode(accountId);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.test_account.reveal_code",
    resourceType: "test_account",
    resourceId: accountId,
    payload: { adminUser: session.username },
  });

  return this.ok(result, request.requestId as string);
}
