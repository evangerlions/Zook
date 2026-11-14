import type { FastifyPluginAsync } from "fastify";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { NativeLearningRepository } from "../modules/lighttick/learning/native-learning.types.ts";
import { LearningContentSyncService } from "../modules/lighttick/learning/content-sync.service.ts";

export const lighttickContentSyncRoutes: FastifyPluginAsync<{
  repo: NativeLearningRepository;
}> = async (app, opts) => {
  const { repo } = opts;
  const syncService = new LearningContentSyncService(repo);

  app.post<{
    Params: { moduleId: string };
  }>("/api/v1/lighttick/learning/modules/:moduleId/sync", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { moduleId } = req.params;
    const { force } = req.body as { force?: boolean };

    const modules = await repo.listLearningModules(owner);
    const module = modules.find((m) => m.id === moduleId);

    if (!module) {
      return reply.status(404).send({ error: "Module not found" });
    }

    if (module.sourceType !== "github" || !module.sourceConfig?.github) {
      return reply.status(400).send({ error: "Module is not configured for GitHub sync" });
    }

    await repo.saveLearningModule(
      {
        ...module,
        syncStatus: "syncing",
        updatedAt: new Date().toISOString(),
      },
      module.revision,
    );

    const result = await syncService.syncModule(owner, module, {
      moduleId,
      force,
    });

    return result;
  });

  app.post("/api/v1/lighttick/learning/modules/sync-all", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { force } = req.body as { force?: boolean };

    const results = await syncService.syncAllModules(owner, { force });

    return {
      synced_at: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        success: results.filter((r) => r.status === "success").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        error: results.filter((r) => r.status === "error").length,
        added: results.reduce((sum, r) => sum + r.added, 0),
        updated: results.reduce((sum, r) => sum + r.updated, 0),
        deleted: results.reduce((sum, r) => sum + r.deleted, 0),
      },
    };
  });

  app.get<{
    Params: { moduleId: string };
  }>("/api/v1/lighttick/learning/modules/:moduleId/sync-status", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { moduleId } = req.params;

    const modules = await repo.listLearningModules(owner);
    const module = modules.find((m) => m.id === moduleId);

    if (!module) {
      return reply.status(404).send({ error: "Module not found" });
    }

    return {
      moduleId: module.id,
      syncStatus: module.syncStatus ?? "idle",
      lastSyncedAt: module.lastSyncedAt ?? null,
      sourceConfig: module.sourceConfig ?? null,
    };
  });
};
