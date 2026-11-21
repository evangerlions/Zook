import type { ErrorCode } from "../../../shared/types.ts";
import type { prepareAiGeneration } from "../ai/lighttick-ai-generation.ts";
import type { preparePlanningGeneration } from "../planning/planning-ai-generation.ts";
import type { LearningSource } from "../learning/learning-work.types.ts";
import type { LearningWorkService } from "../learning/learning-work.service.ts";
import type { LightTickScopePolicy } from "../lighttick-runtime-scope.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { ResolveLocalScene } from "./local-generation-rules.ts";
import type { LightTickOwner } from "../lighttick.types.ts";

export const LOCAL_GENERATION_SCENES = [
  "month_plan", "week_plan", "day_plan", "planning_clarify", "learning_route", "learning_lesson", "learning_schedule",
] as const;

export type LocalGenerationScene = (typeof LOCAL_GENERATION_SCENES)[number];
type GenericContext = Awaited<ReturnType<typeof prepareAiGeneration>>["context"];
type PlanningContext = Awaited<ReturnType<typeof preparePlanningGeneration>>["context"];

export interface LocalGenerationContract {
  scene: LocalGenerationScene;
  scene_key: string;
  skill_key: string;
  prompt_version: string;
  schema_version: string;
  rules_digest: string;
  system_prompt: string;
  scene_prompt: string;
  output_schema: object;
  model_requirements: {
    response_format: "json_object";
    max_output_tokens: number;
    max_context_tokens: number;
    temperature: number;
    timeout_ms: number;
  };
}

export interface LocalGenerationPackage extends Omit<LocalGenerationContract, "system_prompt" | "scene_prompt"> {
  id: string;
  revision: number;
  digest: string;
  expires_at: string;
  messages: { role: "system" | "user"; content: string }[];
}

export type LocalGenerationSnapshot =
  | { kind: "plan"; context: GenericContext; businessDigest: string }
  | { kind: "planning"; context: PlanningContext; clarify: boolean }
  | { kind: "learning"; sources: LearningSource[]; consentRevision: number };

export interface LocalGeneration extends LightTickOwner {
  id: string;
  scene: LocalGenerationScene;
  businessType: "work" | "run";
  businessId: string;
  prepareHash: string;
  rulesDigest: string;
  expiresAt: string;
  status: "prepared" | "succeeded" | "cancelled" | "expired" | "rejected";
  pending?: { package: LocalGenerationPackage; snapshot: LocalGenerationSnapshot };
  result?: { key: string; hash: string; resourceId?: string };
  error?: { status: number; code: ErrorCode; message: string };
}

export interface LocalGenerationRepository {
  get(owner: LightTickOwner, id: string): Promise<LocalGeneration | undefined>;
  pending(owner: LightTickOwner): Promise<LocalGeneration[]>;
  save(row: LocalGeneration): Promise<void>;
}

export interface LocalGenerationRuntime {
  repository: LightTickRepository;
  scopePolicy: Pick<LightTickScopePolicy, "assertFull">;
  planningEnabled: boolean;
  learningWork?: LearningWorkService;
  resolveAiScene?: ResolveLocalScene;
}
