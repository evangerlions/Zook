import type {
  AdminAiNovelConversationRecordDocument,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const BASE_PATH = "/api/v1/admin/apps/ai_novel/conversation-records";

export async function tryHandleAdminAiNovelConversationRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "GET" || request.path !== BASE_PATH) return undefined;

  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiNovelConversationRecords({
    uid: request.query?.uid,
    did: request.query?.did,
    page: parsePage(request.query?.page),
  });
  await this.auditInterceptor.record({
    appId: "ai_novel",
    action: "admin.ai_novel_conversation.read",
    resourceType: "conversation_records",
    resourceId: result.query.uid ? "uid" : result.query.did ? "did" : "all",
    payload: {
      adminUser,
      page: result.page,
      queryType: result.query.uid ? "uid" : result.query.did ? "did" : "all",
    },
  });
  return this.ok(
    result,
    request.requestId as string,
  ) as HttpResponse<AdminAiNovelConversationRecordDocument>;
}

function parsePage(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) {
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "page must be a non-negative integer.");
  }
  return Number(value);
}
