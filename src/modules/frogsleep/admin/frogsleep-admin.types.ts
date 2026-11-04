export const frogSleepAdminResources = ["accounts", "invitations", "relationships", "grants", "sleep_sessions", "focus_sessions", "reports", "devices", "notifications", "email_deliveries"] as const;
export type FrogSleepAdminResource = typeof frogSleepAdminResources[number];
/** Metadata explicitly permitted in the administrator console; private payloads are excluded. */
export interface FrogSleepAdminRow {
  id: string;
  status: string;
  user_id?: string;
  partner_user_id?: string;
  domain?: string;
  version?: number;
  attempts?: number;
  outcome?: string;
  updated_at: string;
}
export interface FrogSleepAdminFilter { resource: FrogSleepAdminResource; page: number; limit: number; userId?: string; status?: string }
export interface FrogSleepAdminPage { items: FrogSleepAdminRow[]; total: number; page: number; limit: number }
/** Scoped operational data access shared by PostgreSQL and test storage. */
export interface FrogSleepAdminStore {
  summary(): Promise<Record<string, number>>;
  search(filter: FrogSleepAdminFilter): Promise<FrogSleepAdminPage>;
}
