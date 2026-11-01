import type { LightTickOwner } from "../lighttick.types.ts";
export interface LocalClaim {
  sourceHash: string;
  userId: string | null;
  entityType: string;
  cloudId: string | null;
  payloadHash: string | null;
  sourcePayload: Record<string, unknown>;
  deleted: boolean;
}
export interface LocalAdoptionRepository {
  lockLocalSource(hash: string): Promise<void>;
  getLocalClaim(hash: string): Promise<LocalClaim | undefined>;
  saveLocalClaim(row: LocalClaim): Promise<void>;
}
export interface LocalGoalInput {
  id: string;
  title: string;
  criteria: string;
  status: "active" | "paused" | "achieved" | "ended";
  archived: boolean;
}
export interface LocalActionInput {
  id: string;
  goal_id: string;
  title: string;
  date: string | null;
  estimated_minutes: number | null;
  criteria: string;
  details: string;
  completed_at: string | null;
  archived: boolean;
  source_reflection_id: string | null;
}
export interface LocalReflectionInput {
  id: string;
  goal_id: string;
  action_id: string | null;
  result: string;
  obstacles: string;
  next_step: string;
  created_at: string;
}
export interface LocalEventInput {
  id: string;
  entity_id: string;
  kind: string;
  value: string;
  created_at: string;
}
export interface LocalAdoptionInput {
  workspace_id: string;
  source_secret: string;
  goals: LocalGoalInput[];
  actions: LocalActionInput[];
  reflections: LocalReflectionInput[];
  events: LocalEventInput[];
}
