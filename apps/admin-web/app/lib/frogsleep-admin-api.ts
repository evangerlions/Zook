import { adminPath, requestJson } from "./admin-api-client";
import type { FrogSleepAdminPage, FrogSleepAdminResource } from "../../../../src/modules/frogsleep/admin/frogsleep-admin.types";
export type { FrogSleepAdminPage, FrogSleepAdminResource, FrogSleepAdminRow } from "../../../../src/modules/frogsleep/admin/frogsleep-admin.types";
export interface FrogSleepOperations { app_id: string; metrics: Record<string, number>; capabilities: Record<string, boolean> }
export const frogSleepAdminApi = {
  operations: () => requestJson<FrogSleepOperations>(adminPath("/apps/frogsleep/operations")),
  records(resource: FrogSleepAdminResource, page: number, userId: string, status: string) {
    const query = new URLSearchParams({ page: String(page), limit: "25" });
    if (userId.trim()) query.set("user_id", userId.trim());
    if (status.trim()) query.set("status", status.trim());
    return requestJson<FrogSleepAdminPage>(adminPath(`/apps/frogsleep/records/${resource}?${query}`));
  },
  retry: (id: string, reason: string) => requestJson<{ queued: boolean }>(adminPath(`/apps/frogsleep/notifications/${encodeURIComponent(id)}/retry`), { method: "POST", body: { reason } }),
};
