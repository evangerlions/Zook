import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * AI 证据面板 — 记录 AI 生成的溯源信息，支持反馈标记。
 */

export type EvidenceKind =
  | "behavior-report"
  | "reflection"
  | "course-summary"
  | "reading"
  | "plan-draft";

export interface EvidenceSource {
  kind: string;
  id: string;
  label: string;
  content_hash: string;
  scope: string;
}

export interface EvidenceSnapshot {
  id: string;
  schema_version: number;
  purpose: EvidenceKind;
  stage: "input" | "output";
  captured_at: string;
  timezone: string;
  model: string;
  messages: { role: string; content: string }[];
  sources: EvidenceSource[];
  input_hash: string;
}

export interface EvidenceLink {
  kind: EvidenceKind;
  resource_id: string;
  stage: "input" | "output";
  snapshot_id: string;
}

export interface EvidenceFeedback {
  snapshot_id: string;
  useful: boolean;
  comment?: string;
  created_at: string;
}

export class LightTickAiEvidenceService {
  constructor(private readonly repository: LightTickRepository) {}

  async list(owner: LightTickOwner, query?: { kind?: EvidenceKind; limit?: number }): Promise<EvidenceSnapshot[]> {
    return await this.repository.listAiEvidenceSnapshots(owner, query);
  }

  async get(owner: LightTickOwner, snapshotId: string): Promise<EvidenceSnapshot | undefined> {
    return await this.repository.getAiEvidenceSnapshot(owner, snapshotId);
  }

  async recordFeedback(owner: LightTickOwner, input: {
    snapshot_id: string;
    useful: boolean;
    comment?: string;
  }): Promise<EvidenceFeedback> {
    if (!input.snapshot_id || input.snapshot_id.length > 128) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "snapshot_id is invalid.");
    }

    const feedback: EvidenceFeedback = {
      snapshot_id: input.snapshot_id,
      useful: input.useful,
      comment: input.comment,
      created_at: new Date().toISOString(),
    };

    await this.repository.saveAiEvidenceFeedback(owner, feedback);
    return feedback;
  }

  async listFeedback(owner: LightTickOwner): Promise<EvidenceFeedback[]> {
    return await this.repository.listAiEvidenceFeedback(owner);
  }
}
