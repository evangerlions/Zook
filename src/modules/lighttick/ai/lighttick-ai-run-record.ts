import { randomId } from "../../../shared/utils.ts";
import { captureModel } from "../personal-model/personal-model.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "./lighttick-ai-scenes.ts";

export async function createLightTickAiRun(
  repository: LightTickRepository, owner: LightTickOwner, kind: string, name: LightTickAiSceneName,
  resourceId: string | undefined, input: Record<string, unknown>, now: string, browserGenerationId?: string,
): Promise<LightTickAiRunRow> {
  const scene = LIGHTTICK_AI_SCENES[name];
  return repository.saveAiRun({
    ...owner, id: randomId("lighttick_run"), kind, resourceId, sceneKey: scene.key,
    status: browserGenerationId ? "running" : "queued", attemptCount: browserGenerationId ? 1 : 0,
    promptVersion: scene.promptVersion, schemaVersion: scene.schemaVersion,
    inputContext: { ...input, ...(browserGenerationId ? { browser_generation_id: browserGenerationId } :
      { model_selection: await captureModel(repository, owner) }) },
    usage: {}, createdAt: now, updatedAt: now, startedAt: browserGenerationId ? now : undefined,
  });
}
