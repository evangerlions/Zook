import type {BodyLogRange, BodyLogHabitTemplate} from "./types";
import {adminPath,requestJson,requestBlob} from "./admin-api-client.ts";
function cleanQuery(query: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export const adminBodyLogApi = {
  getBodyLogCheckinDashboard(range: BodyLogRange = "30d") {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(`${to}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - days + 1);
    const from = fromDate.toISOString().slice(0, 10);
    return requestJson<import("./types").BodyLogCheckinDashboardDocument>(
      adminPath(`/apps/bodylog/checkin/dashboard?${new URLSearchParams({ range, from, to, timezone: "Asia/Shanghai" }).toString()}`),
    );
  },
  getBodyLogCheckinRecords(input: { query?: string; userId?: string; groupId?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
    return requestJson<import("./types").BodyLogCheckinRecordsDocument>(
      adminPath(`/apps/bodylog/checkin/records?${new URLSearchParams(cleanQuery({
        query: input.query,
        user_id: input.userId,
        group_id: input.groupId,
        from: input.from,
        to: input.to,
        page: input.page?.toString(),
        limit: input.limit?.toString(),
      })).toString()}`),
    );
  },
  exportBodyLogCheckinRecordsCsv(input: { userId?: string; groupId?: string; from?: string; to?: string } = {}) {
    return requestBlob(adminPath(`/apps/bodylog/checkin/records/export?${new URLSearchParams(cleanQuery({
      user_id: input.userId,
      group_id: input.groupId,
      from: input.from,
      to: input.to,
    })).toString()}`));
  },
  listBodyLogGroups(input: { status?: string; health?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
    return requestJson<import("./types").BodyLogGroupListDocument>(
      adminPath(`/apps/bodylog/groups?${new URLSearchParams(cleanQuery({
        status: input.status,
        health: input.health,
        from: input.from,
        to: input.to,
        page: input.page?.toString(),
        limit: input.limit?.toString(),
      })).toString()}`),
    );
  },
  getBodyLogGroupMemberContributions(groupId: string, input: { from?: string; to?: string } = {}) {
    return requestJson<{ items: import("./types").BodyLogGroupMember[] }>(
      adminPath(`/apps/bodylog/groups/${encodeURIComponent(groupId)}/members?${new URLSearchParams(cleanQuery(input)).toString()}`),
    );
  },
  listBodyLogHabitTemplates() {
    return requestJson<{ items: BodyLogHabitTemplate[] }>(adminPath("/apps/bodylog/habit-templates"));
  },
  createBodyLogHabitTemplate(input: Omit<BodyLogHabitTemplate, "id" | "appId" | "createdAt" | "updatedAt" | "status">) {
    return requestJson<{ item: BodyLogHabitTemplate }>(adminPath("/apps/bodylog/habit-templates"), { method: "POST", body: input });
  },
  updateBodyLogHabitTemplate(id: string, input: Partial<Omit<BodyLogHabitTemplate, "id" | "appId" | "createdAt" | "updatedAt">>) {
    return requestJson<{ item: BodyLogHabitTemplate }>(adminPath(`/apps/bodylog/habit-templates/${encodeURIComponent(id)}`), { method: "PUT", body: input });
  },
  deleteBodyLogHabitTemplate(id: string) {
    return requestJson<{ deleted: boolean; archived: boolean }>(adminPath(`/apps/bodylog/habit-templates/${encodeURIComponent(id)}`), { method: "DELETE" });
  },
  getBodyLogHabitTemplateUsage(input: { from?: string; to?: string } = {}) {
    return requestJson<import("./types").BodyLogHabitUsageDocument>(
      adminPath(`/apps/bodylog/habit-templates/usage?${new URLSearchParams(cleanQuery(input)).toString()}`),
    );
  },
};
