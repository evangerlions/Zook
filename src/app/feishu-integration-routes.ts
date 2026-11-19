import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { expenseInput } from "../modules/feishu/expense-input.ts";
import { strictObject } from "../shared/strict-object.ts";
import type { FeishuScope } from "../modules/feishu/feishu-config.ts";
import { FeishuApiError } from "../modules/feishu/feishu-client.ts";
import { validateIntegrationInput } from "../modules/feishu/integration-contract.ts";

type FeishuRouteContext = Pick<BackendRouteContext, "feishuServices" | "ok">;

const MESSAGE_PATH = "/api/v1/notifications/feishu/messages";
const LEDGER_PATH = "/api/v1/integrations/feishu/bookkeeping";
export function isFeishuIntegrationPath(path: string) { return path === MESSAGE_PATH || path.startsWith(`${LEDGER_PATH}/`); }

export async function tryHandleFeishuIntegrationRoutes(context: FeishuRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  try { return await handleIntegration(context, request); }
  catch (error) {
    if (error instanceof FeishuApiError) throw new ApplicationError(502, "FEISHU_UNAVAILABLE", error.message);
    throw error;
  }
}

async function handleIntegration(context: FeishuRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const { path, method } = request;
  if (!isFeishuIntegrationPath(path)) return;
  const integration = context.feishuServices;
  if (!integration) throw new ApplicationError(503, "FEISHU_UNCONFIGURED", "Feishu integration is unavailable.");
  let scope: FeishuScope;
  if (path === MESSAGE_PATH && method === "POST") scope = "messages:send";
  else if (path === `${LEDGER_PATH}/records` && method === "POST") scope = "bookkeeping:create";
  else if (method === "GET" && (path === `${LEDGER_PATH}/schema` || path === `${LEDGER_PATH}/categories` || path === `${LEDGER_PATH}/records` || /^\/api\/v1\/integrations\/feishu\/bookkeeping\/records\/rec[A-Za-z0-9]+$/.test(path))) scope = "bookkeeping:read";
  else throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Route not found.");
  const caller = await integration.access.authorize(request, scope);
  if (path !== `${LEDGER_PATH}/records` || method !== "GET") strictObject(request.query ?? {}, []);
  let result: unknown;
  if (scope === "messages:send") {
    validateIntegrationInput("message", request.body);
    const body = strictObject(request.body, ["text"]);
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 2000) throw new ApplicationError(400, "REQ_INVALID_BODY", "Message text must contain 1–2000 characters.");
    const text = body.text;
    await integration.client.token();
    result = await integration.receipts.execute(caller, scope, request.headers["idempotency-key"], { text }, id => integration.client.send(text, id));
  } else if (scope === "bookkeeping:create") {
    validateIntegrationInput("expense", request.body);
    const input = expenseInput(request.body);
    await integration.client.token();
    // Validation happens inside the claim so a replay does not require an unchanged external schema.
    result = await integration.receipts.execute(caller, scope, request.headers["idempotency-key"], input,
      async () => {
        let fields: Record<string, unknown>;
        try { fields = await integration.bookkeeping.prepare(input); }
        catch (error) {
          if (error instanceof FeishuApiError) throw new ApplicationError(502, "FEISHU_UNAVAILABLE", "Ledger validation failed before creating any record. Check Feishu availability and permissions.");
          throw error;
        }
        return integration.bookkeeping.create(fields);
      });
  } else if (path.endsWith("/schema")) result = await integration.bookkeeping.schema();
  else if (path.endsWith("/categories")) result = await integration.bookkeeping.categories();
  else if (path === `${LEDGER_PATH}/records`) {
    const query = strictObject(request.query ?? {}, ["pageSize", "pageToken"]);
    result = await integration.bookkeeping.list(query.pageSize === undefined ? 100 : Number(query.pageSize), query.pageToken as string | undefined);
  } else result = await integration.bookkeeping.get(path.split("/").at(-1)!);
  const receipt = result as { status?: string; operationId?: string; result?: { messageId?: string; recordId?: string } };
  integration.logger.info("Feishu integration operation", { caller, operation: scope,
    target: scope === "messages:send" ? "self" : "expenses", requestId: request.requestId,
    outcome: receipt.status ?? "read", operationId: receipt.operationId,
    resultId: receipt.result?.messageId ?? receipt.result?.recordId });
  const response = context.ok(result, request.requestId!);
  response.headers = { ...response.headers, "Cache-Control": "no-store" };
  return response;
}
