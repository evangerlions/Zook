import { randomUUID } from "node:crypto";
import { badRequest, conflict } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { BodyLogHabitTemplateRecord } from "../modules/bodylog/bodylog-admin.types.ts";

const BODYLOG_APP_ID = "bodylog";
const DEFAULT_RANGE_DAYS = 30;
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 50_000;

function queryValue(request: HttpRequest, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = request.query?.[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parsePage(request: HttpRequest): { page: number; limit: number } {
  const rawPage = Number(queryValue(request, "page") ?? "1");
  const rawLimit = Number(queryValue(request, "limit") ?? "50");
  if (!Number.isInteger(rawPage) || rawPage < 1 || !Number.isInteger(rawLimit) || rawLimit < 1) {
    badRequest("REQ_INVALID_QUERY", "page and limit must be positive integers.");
  }
  return { page: rawPage, limit: Math.min(rawLimit, MAX_PAGE_SIZE) };
}

function dateRange(request: HttpRequest): { fromDate: string; toDate: string } {
  const toDate = queryValue(request, "to", "to_date") ?? new Date().toISOString().slice(0, 10);
  const fromDate = queryValue(request, "from", "from_date") ?? (() => {
    const date = new Date(`${toDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - DEFAULT_RANGE_DAYS + 1);
    return date.toISOString().slice(0, 10);
  })();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate) {
    badRequest("REQ_INVALID_QUERY", "from and to must be valid dates with from no later than to.");
  }
  return { fromDate, toDate };
}

function asObjectBody(context: BackendRouteContext, request: HttpRequest): Record<string, unknown> {
  return context.validationPipe.asObject(request.body ?? {});
}

function requireTemplatePayload(body: Record<string, unknown>, existing?: BodyLogHabitTemplateRecord): BodyLogHabitTemplateRecord {
  const templateKey = typeof body.templateKey === "string" ? body.templateKey.trim() : existing?.templateKey;
  const category = typeof body.category === "string" ? body.category.trim() : existing?.category ?? "general";
  const names = (body.names ?? existing?.names) as unknown;
  const icon = body.icon === null ? null : typeof body.icon === "string" ? body.icon.trim() || null : existing?.icon ?? null;
  const target = body.defaultTargetCount ?? existing?.defaultTargetCount ?? 1;
  const sortOrder = body.sortOrder ?? existing?.sortOrder ?? 0;

  if (!templateKey || !/^[a-z0-9_:-]{1,64}$/.test(templateKey)) {
    badRequest("REQ_INVALID_BODY", "templateKey must match ^[a-z0-9_:-]{1,64}$.");
  }
  if (!/^[a-z0-9_-]{1,32}$/.test(category)) {
    badRequest("REQ_INVALID_BODY", "category must match ^[a-z0-9_-]{1,32}$.");
  }
  if (!names || typeof names !== "object" || Array.isArray(names)) {
    badRequest("REQ_INVALID_BODY", "names must be an object containing zh-CN and en-US.");
  }
  const normalizedNames: Record<string, string> = {};
  for (const [locale, value] of Object.entries(names as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) normalizedNames[locale] = value.trim();
  }
  if (!normalizedNames["zh-CN"] || !normalizedNames["en-US"]) {
    badRequest("REQ_INVALID_BODY", "names must contain non-empty zh-CN and en-US values.");
  }
  if (typeof target !== "number" || !Number.isInteger(target) || target < 1) {
    badRequest("REQ_INVALID_BODY", "defaultTargetCount must be a positive integer.");
  }
  if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0) {
    badRequest("REQ_INVALID_BODY", "sortOrder must be a non-negative integer.");
  }

  const now = new Date().toISOString();
  return {
    id: existing?.id ?? randomUUID(),
    appId: BODYLOG_APP_ID,
    templateKey,
    category,
    names: normalizedNames,
    icon,
    defaultTargetCount: target,
    sortOrder,
    status: existing?.status ?? "active",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

async function resolveUserId(context: BackendRouteContext, request: HttpRequest): Promise<string | undefined> {
  const explicitUserId = queryValue(request, "user_id", "userId");
  if (explicitUserId) return explicitUserId;
  const query = queryValue(request, "query");
  if (!query) return undefined;
  const byId = await context.database.findUserById(query);
  const byAccount = await context.database.findUserByAccount(query);
  const byPhone = await context.database.findUserByPhone(query);
  const ids = new Set([byId?.id, byAccount?.id, byPhone?.id].filter((value): value is string => Boolean(value)));
  if (ids.size > 1) badRequest("REQ_INVALID_QUERY", "The user query matches multiple accounts.");
  return ids.values().next().value as string | undefined;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function csvResponse(csv: string, requestId?: string): HttpResponse<unknown> {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=bodylog-checkin-records.csv",
    },
    contentType: "text/csv; charset=utf-8",
    body: {
      code: "OK",
      message: "success",
      data: null,
      requestId: requestId ?? "",
    },
    streamBody: (async function* () {
      yield csv;
    })(),
  };
}

export async function tryHandleBodyLogAdminRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith("/api/v1/admin/apps/bodylog/")) return undefined;

  const dashboardPath = "/api/v1/admin/apps/bodylog/checkin/dashboard";
  const recordsPath = "/api/v1/admin/apps/bodylog/checkin/records";
  const exportPath = "/api/v1/admin/apps/bodylog/checkin/records/export";
  const groupsPath = "/api/v1/admin/apps/bodylog/groups";
  const templatesPath = "/api/v1/admin/apps/bodylog/habit-templates";

  if (request.method === "GET" && request.path === dashboardPath) {
    const session = this.requireAdminSession(request);
    const { fromDate, toDate } = dateRange(request);
    const result = await this.database.getBodyLogCheckinDashboard({
      appId: BODYLOG_APP_ID,
      fromDate,
      toDate,
      timezone: queryValue(request, "timezone") ?? "Asia/Shanghai",
    });
    await this.recordAdminReadAudit(session.adminUser, "bodylog.checkin_dashboard.read", "checkin_dashboard", BODYLOG_APP_ID, request.requestId);
    return this.ok({
      app_id: BODYLOG_APP_ID,
      from: fromDate,
      to: toDate,
      ...result,
      privacy: { aggregates_only: true, private_text_visible: false },
    }, request.requestId as string);
  }

  if (request.method === "GET" && request.path === recordsPath) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.checkin-records.read");
    const { fromDate, toDate } = dateRange(request);
    const { page, limit } = parsePage(request);
    const result = await this.database.searchBodyLogCheckinRecords({
      appId: BODYLOG_APP_ID,
      userId: await resolveUserId(this, request),
      groupId: queryValue(request, "group_id", "groupId"),
      fromDate,
      toDate,
      page,
      limit,
    });
    await this.recordAdminReadAudit(session.adminUser, "bodylog.checkin_records.read", "checkin_records", BODYLOG_APP_ID, request.requestId);
    return this.ok({
      app_id: BODYLOG_APP_ID,
      items: result.items,
      total: result.total,
      page,
      limit,
      privacy: { aggregates_only: false, user_level: true },
    }, request.requestId as string);
  }

  if (request.method === "GET" && request.path === exportPath) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.checkin-records.export");
    const { fromDate, toDate } = dateRange(request);
    const result = await this.database.searchBodyLogCheckinRecords({
      appId: BODYLOG_APP_ID,
      userId: await resolveUserId(this, request),
      groupId: queryValue(request, "group_id", "groupId"),
      fromDate,
      toDate,
      page: 1,
      limit: MAX_EXPORT_ROWS,
    });
    const rows = result.items.slice(0, MAX_EXPORT_ROWS);
    const csv = [
      "\uFEFF" + ["record_id", "date", "group_id", "group_name", "user_id", "completed_count", "total_members", "completion_rate", "created_at"].map(csvCell).join(","),
      ...rows.map(row => [row.recordId, row.date, row.groupId, row.groupName, row.userId, row.completedCount, row.totalMembers, row.completionRate, row.createdAt].map(csvCell).join(",")),
    ].join("\n");
    await this.recordAdminReadAudit(session.adminUser, "bodylog.checkin_records.export", "checkin_records", BODYLOG_APP_ID, request.requestId);
    return csvResponse(csv, request.requestId);
  }

  if (request.method === "GET" && request.path === groupsPath) {
    const session = this.requireAdminSession(request);
    const { fromDate, toDate } = dateRange(request);
    const { page, limit } = parsePage(request);
    const result = await this.database.listBodyLogGroupHealth({
      appId: BODYLOG_APP_ID,
      status: queryValue(request, "status"),
      health: queryValue(request, "health") as "active" | "stale" | "dead" | undefined,
      fromDate,
      toDate,
      page,
      limit,
    });
    await this.recordAdminReadAudit(session.adminUser, "bodylog.group_health.read", "group_health", BODYLOG_APP_ID, request.requestId);
    return this.ok({
      app_id: BODYLOG_APP_ID,
      items: result.items,
      total: result.total,
      page,
      limit,
      privacy: { aggregates_only: true, private_text_visible: false },
    }, request.requestId as string);
  }

  const groupMembersMatch = request.path.match(/^\/api\/v1\/admin\/apps\/bodylog\/groups\/([^/]+)\/members$/);
  if (request.method === "GET" && groupMembersMatch) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.checkin-records.read");
    const { fromDate, toDate } = dateRange(request);
    const items = await this.database.listBodyLogGroupMemberContributions({
      groupId: decodeURIComponent(groupMembersMatch[1] as string),
      fromDate,
      toDate,
    });
    await this.recordAdminReadAudit(session.adminUser, "bodylog.group_members.read", "group_members", BODYLOG_APP_ID, request.requestId);
    return this.ok({ items, privacy: { aggregates_only: false, user_level: true } }, request.requestId as string);
  }

  if (request.method === "GET" && request.path === `${templatesPath}/usage`) {
    const session = this.requireAdminSession(request);
    const { fromDate, toDate } = dateRange(request);
    const items = await this.database.listBodyLogHabitUsage({ appId: BODYLOG_APP_ID, fromDate, toDate });
    await this.recordAdminReadAudit(session.adminUser, "bodylog.habit_templates.usage.read", "habit_template_usage", BODYLOG_APP_ID, request.requestId);
    return this.ok({ items, from: fromDate, to: toDate }, request.requestId as string);
  }

  if (request.method === "GET" && request.path === templatesPath) {
    const session = this.requireAdminSession(request);
    const items = await this.database.listBodyLogHabitTemplates(BODYLOG_APP_ID);
    await this.recordAdminReadAudit(session.adminUser, "bodylog.habit_templates.read", "habit_templates", BODYLOG_APP_ID, request.requestId);
    return this.ok({ items }, request.requestId as string);
  }

  const templateMatch = request.path.match(/^\/api\/v1\/admin\/apps\/bodylog\/habit-templates\/([^/]+)$/);
  if (request.method === "POST" && request.path === templatesPath) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.habit-templates.write");
    const record = requireTemplatePayload(asObjectBody(this, request));
    if (await this.database.findBodyLogHabitTemplateByKey(BODYLOG_APP_ID, record.templateKey)) {
      conflict("REQ_INVALID_BODY", "A habit template with this key already exists.");
    }
    await this.database.insertBodyLogHabitTemplate(record);
    return this.ok({ item: record }, request.requestId as string);
  }

  if (request.method === "PUT" && templateMatch) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.habit-templates.write");
    const id = decodeURIComponent(templateMatch[1] as string);
    const existing = await this.database.findBodyLogHabitTemplate(BODYLOG_APP_ID, id);
    if (!existing) return this.ok({ item: null }, request.requestId as string);
    const record = requireTemplatePayload(asObjectBody(this, request), existing);
    const sameKey = await this.database.findBodyLogHabitTemplateByKey(BODYLOG_APP_ID, record.templateKey);
    if (sameKey && sameKey.id !== id) conflict("REQ_INVALID_BODY", "A habit template with this key already exists.");
    await this.database.updateBodyLogHabitTemplate(record);
    return this.ok({ item: record }, request.requestId as string);
  }

  if (request.method === "DELETE" && templateMatch) {
    const session = this.requireAdminSession(request);
    await this.assertAdminSensitiveOperation(session, "bodylog.habit-templates.write");
    const id = decodeURIComponent(templateMatch[1] as string);
    const existing = await this.database.findBodyLogHabitTemplate(BODYLOG_APP_ID, id);
    if (!existing) return this.ok({ deleted: false }, request.requestId as string);
    await this.database.updateBodyLogHabitTemplate({ ...existing, status: "archived", updatedAt: new Date().toISOString() });
    return this.ok({ deleted: true, archived: true }, request.requestId as string);
  }

  return undefined;
}
