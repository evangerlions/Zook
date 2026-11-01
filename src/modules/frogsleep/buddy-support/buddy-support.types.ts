export type SupportDomain = "sleep" | "focus";
export const supportTemplates = {
  focus_start_small: "focus", focus_keep_pace: "focus", focus_effort_seen: "focus", focus_restart: "focus",
  sleep_goodnight: "sleep", sleep_no_rush: "sleep", sleep_morning: "sleep", sleep_support: "sleep",
} as const;
export type SupportTemplate = keyof typeof supportTemplates;
export interface SupportContext { type: "buddy_share" | "buddy_joint_activity"; id: string }
export interface SupportSubmission {
  relationship_id: string;
  operation_id: string;
  template_key: SupportTemplate | null;
  flower: boolean;
  context: SupportContext | null;
}
export interface SupportNote {
  app_id: string;
  id: string;
  relationship_id: string;
  domain: SupportDomain;
  sender_id: string;
  recipient_id: string;
  template_key: SupportTemplate | null;
  template_version: number;
  flower: boolean;
  context: SupportContext | null;
  created_at: string;
  expires_at: string;
}
export interface SupportPermission {
  app_id: string; relationship_id: string; recipient_id: string;
  enabled: boolean; revision: number; updated_at: string;
}
export interface SupportOperation {
  app_id: string; actor_id: string; operation_id: string;
  command_type: "send" | "permission" | "ack"; relationship_id: string;
  request_digest: string; state: "accepted" | "not_sent";
  resource_id: string | null; result: Record<string, unknown> | null; created_at: string;
}
export interface SupportNoteFilter {
  actor: string; relationships: string[]; partner?: string; domain?: SupportDomain;
  before?: { created_at: string; id: string }; limit: number; now: string;
}
/** Stores support records inside the caller's existing buddy transaction. */
export interface BuddySupportRepository {
  isEnrolled(app: string, relationship: string): Promise<boolean>;
  enroll(app: string, relationship: string, now: string): Promise<void>;
  permission(app: string, relationship: string, recipient: string): Promise<SupportPermission | undefined>;
  savePermission(value: SupportPermission): Promise<void>;
  operation(app: string, actor: string, id: string): Promise<SupportOperation | undefined>;
  saveOperation(value: SupportOperation): Promise<void>;
  insertNote(value: SupportNote): Promise<void>;
  note(app: string, id: string): Promise<SupportNote | undefined>;
  notes(app: string, filter: SupportNoteFilter): Promise<SupportNote[]>;
  latestReceived(app: string, actor: string, relationships: string[], now: string): Promise<SupportNote[]>;
  recentSent(app: string, actor: string, recipient: string, after: string): Promise<string[]>;
  acknowledged(app: string, id: string): Promise<boolean>;
  acknowledge(app: string, id: string, recipient: string, now: string): Promise<void>;
  cleanup(app: string, now: string): Promise<void>;
  deleteUser(app: string, actor: string, relationshipIDs?: string[]): Promise<void>;
}
