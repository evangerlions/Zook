import type { LightTickOwner } from "../lighttick.types.ts";

export const stageOutcomeStatuses = ["unknown", "not_started", "in_progress", "delivered", "passed", "failed", "submitted", "accepted"] as const;
type OutcomeStatus = typeof stageOutcomeStatuses[number];

export type StageOutcomeValue =
  | { kind: "text"; value: { value: string } }
  | { kind: "number"; value: { value: number; unit: string; comparable_condition?: string } }
  | { kind: "status"; value: { value: OutcomeStatus } };

export type StageOutcomeEvidenceRow = LightTickOwner & StageOutcomeValue & {
  id: string;
  goalId: string;
  stageId: string;
  occurredOn: string;
  recordedAt: string;
  metric: string;
  version: number;
  taskId?: string;
  taskTitle?: string;
  correctedFrom?: string;
};

export type StageOutcomeEvidenceHistory = StageOutcomeEvidenceRow & { isCurrent: boolean };
export interface StageOutcomeEvidenceWindow { stageId?: string; startsOn?: string; endsOn?: string; }

export interface StageOutcomeEvidenceStore {
  list(owner: LightTickOwner, goalId: string, window?: StageOutcomeEvidenceWindow): Promise<StageOutcomeEvidenceHistory[]>;
  get(owner: LightTickOwner, goalId: string, stageId: string, id: string): Promise<StageOutcomeEvidenceHistory | undefined>;
  stageIds(owner: LightTickOwner, goalId: string): Promise<string[]>;
  add(row: StageOutcomeEvidenceRow): Promise<void>;
}
