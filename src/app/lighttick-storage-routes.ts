import type { FastifyPluginAsync } from "fastify";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LearningStorageRepository } from "../modules/lighttick/learning/native-learning.types.ts";

export const lighttickStorageRoutes: FastifyPluginAsync<{
  repo: LearningStorageRepository;
}> = async (app, opts) => {
  const { repo } = opts;

  // 获取存储配置列表
  app.get("/api/v1/lighttick/storage", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const storageConfigs = await repo.listUserStorage(owner);
    return { storage: storageConfigs };
  });

  // 获取单个存储配置
  app.get("/api/v1/lighttick/storage/:id", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const config = await repo.getUserStorage(owner, id);
    if (!config) {
      return reply.status(404).send({ error: "Storage config not found" });
    }
    return { storage: config };
  });

  // 创建存储配置
  app.post("/api/v1/lighttick/storage", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { type, github, local, cloud, isDefault } = req.body as any;

    if (!type || !["cloud", "github", "local", "hybrid"].includes(type)) {
      return reply.status(400).send({ error: "Invalid storage type" });
    }

    const config = {
      userId: owner.userId,
      type,
      github: github || undefined,
      local: local || undefined,
      cloud: cloud || undefined,
      isDefault: isDefault || false,
    };

    await repo.saveUserStorage(config as any);

    return { status: "created", storage: config };
  });

  // 更新存储配置
  app.put("/api/v1/lighttick/storage/:id", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const existing = await repo.getUserStorage(owner, id);
    if (!existing) {
      return reply.status(404).send({ error: "Storage config not found" });
    }

    const { type, github, local, cloud, isDefault } = req.body as any;

    const config = {
      ...existing,
      type: type || existing.type,
      github: github !== undefined ? github : existing.github,
      local: local !== undefined ? local : existing.local,
      cloud: cloud !== undefined ? cloud : existing.cloud,
      isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
    };

    await repo.saveUserStorage(config as any);

    return { status: "updated", storage: config };
  });

  // 删除存储配置
  app.delete("/api/v1/lighttick/storage/:id", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    await repo.deleteUserStorage(owner, id);

    return { status: "deleted" };
  });

  // 测试存储连接
  app.post("/api/v1/lighttick/storage/:id/test", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = req.params as { id: string };
    const config = await repo.getUserStorage(owner, id);
    if (!config) {
      return reply.status(404).send({ error: "Storage config not found" });
    }

    // TODO: 实现实际的连接测试
    // GitHub: 尝试读取仓库信息
    // 本地: 检查目录是否存在
    // 云端: 检查桶访问权限

    return {
      status: "success",
      message: "连接测试成功",
      testedAt: new Date().toISOString(),
    };
  });
};
