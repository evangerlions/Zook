import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * AI 反思引导 — 帮助用户想深一点（追问）与整理（三段整理）。
 */

export type ReflectionAssistKind = "clarify" | "organize";

export interface ReflectionAssistRequest {
  reflection_id: string;
  kind: ReflectionAssistKind;
  text: string;
}

export interface ReflectionAssistQuestion {
  id: string;
  text: string;
  anchor?: string;
}

export interface ReflectionAssistSection {
  kind: "event" | "understanding" | "next_step";
  text: string;
  basis: "statement" | "suggestion";
}

export interface ReflectionAssistResult {
  attempt_id: string;
  status: "queued" | "ready" | "failed";
  questions?: ReflectionAssistQuestion[];
  sections?: ReflectionAssistSection[];
  error?: string;
}

export class LightTickReflectionAssistService {
  constructor(private readonly repository: LightTickRepository) {}

  async assist(owner: LightTickOwner, input: ReflectionAssistRequest): Promise<ReflectionAssistResult> {
    if (!input.reflection_id || input.reflection_id.length > 128) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "reflection_id is invalid.");
    }
    if (input.kind !== "clarify" && input.kind !== "organize") {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "kind must be 'clarify' or 'organize'.");
    }
    if (!input.text || input.text.trim().length === 0) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "text is required.");
    }
    if (input.text.length > 4000) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "text must be ≤4000 chars.");
    }

    const attemptId = `assist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // For MVP, return a simulated response
    // In production, this would call the AI service
    if (input.kind === "clarify") {
      return {
        attempt_id: attemptId,
        status: "ready",
        questions: [
          {
            id: "q1",
            text: "这个经历中，哪个时刻让你印象最深？为什么？",
            anchor: input.text.slice(0, 50),
          },
        ],
      };
    } else {
      return {
        attempt_id: attemptId,
        status: "ready",
        sections: [
          {
            kind: "event",
            text: input.text.slice(0, 200),
            basis: "statement",
          },
          {
            kind: "understanding",
            text: "从这段经历中，我认识到...",
            basis: "suggestion",
          },
          {
            kind: "next_step",
            text: "接下来我想尝试...",
            basis: "suggestion",
          },
        ],
      };
    }
  }

  async getAttempt(owner: LightTickOwner, attemptId: string): Promise<ReflectionAssistResult | undefined> {
    // For MVP, attempts are not persisted
    // In production, this would query the database
    return undefined;
  }
}
