import type { FastifyPluginAsync } from "fastify";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { NativeLearningRepository } from "../modules/lighttick/learning/native-learning.types.ts";

// 套餐定义
const PRICING_PLANS = {
  basic: {
    id: "basic",
    name: "免费版",
    price: { monthly: 0, yearly: 0 },
    storage: {
      totalSpace: 500 * 1024 * 1024, // 500 MB
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 1000,
      maxVersions: 100,
      maxModules: 20,
      githubStorage: true,
      cloudStorage: false,
      urlImport: false,
      marketplace: false,
    },
    features: ["基础学习模块", "GitHub 存储", "版本历史"],
    limits: {
      apiCallsPerHour: 100,
      syncFrequency: "manual" as const,
      webhookEvents: 0,
      marketplaceDownloads: 0,
    },
  },
  premium: {
    id: "premium",
    name: "高级版",
    price: { monthly: 29, yearly: 278 },
    storage: {
      totalSpace: 5 * 1024 * 1024 * 1024, // 5 GB
      maxFileSize: 100 * 1024 * 1024, // 100 MB
      maxFiles: 10000,
      maxVersions: 1000,
      maxModules: 100,
      githubStorage: true,
      cloudStorage: true,
      urlImport: true,
      marketplace: true,
    },
    features: ["高级版全部功能", "云端存储", "URL 导入", "内容市场", "优先支持"],
    limits: {
      apiCallsPerHour: 1000,
      syncFrequency: "hourly" as const,
      webhookEvents: 1000,
      marketplaceDownloads: 100,
    },
  },
  professional: {
    id: "professional",
    name: "专业版",
    price: { monthly: 99, yearly: 950 },
    storage: {
      totalSpace: 50 * 1024 * 1024 * 1024, // 50 GB
      maxFileSize: 500 * 1024 * 1024, // 500 MB
      maxFiles: 100000,
      maxVersions: -1,
      maxModules: -1,
      githubStorage: true,
      cloudStorage: true,
      urlImport: true,
      marketplace: true,
    },
    features: ["专业版全部功能", "无限存储", "无限版本", "专属支持", "API 访问"],
    limits: {
      apiCallsPerHour: 10000,
      syncFrequency: "realtime" as const,
      webhookEvents: -1,
      marketplaceDownloads: -1,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "企业版",
    price: { monthly: 0, yearly: 0 },
    storage: {
      totalSpace: -1, // 无限
      maxFileSize: -1,
      maxFiles: -1,
      maxVersions: -1,
      maxModules: -1,
      githubStorage: true,
      cloudStorage: true,
      urlImport: true,
      marketplace: true,
    },
    features: ["企业级功能", "私有部署", "SLA 保障", "专属客户经理"],
    limits: {
      apiCallsPerHour: -1,
      syncFrequency: "realtime" as const,
      webhookEvents: -1,
      marketplaceDownloads: -1,
    },
  },
};

export const lighttickBillingRoutes: FastifyPluginAsync<{
  repo: NativeLearningRepository;
}> = async (app, opts) => {
  const { repo } = opts;

  // 获取用户套餐和存储使用情况
  app.get("/api/v1/lighttick/billing/subscription", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const subscription = await repo.getUserSubscription(owner);
    const usage = await repo.getStorageUsage(owner);

    const planId = subscription?.planId || "basic";
    const plan = PRICING_PLANS[planId as keyof typeof PRICING_PLANS];

    return {
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        storage: plan.storage,
        features: plan.features,
      },
      storage: {
        used: usage.totalUsed,
        total: usage.totalLimit,
        percentage: usage.percentage,
        breakdown: usage.breakdown,
        topModules: usage.topModules,
      },
      usage: {
        apiCalls: {
          used: 0, // TODO: implement API usage tracking
          limit: plan.limits.apiCallsPerHour,
          resetAt: new Date(Date.now() + 3600000).toISOString(),
        },
        syncFrequency: plan.limits.syncFrequency,
        marketplaceDownloads: {
          used: 0,
          limit: plan.limits.marketplaceDownloads,
        },
      },
      billing: subscription
        ? {
            status: subscription.status,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            nextBillingDate: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
    };
  });

  // 检查存储配额
  app.post("/api/v1/lighttick/billing/check-quota", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { operation, size } = req.body as {
      operation: string;
      size: number;
    };

    const subscription = await repo.getUserSubscription(owner);
    const usage = await repo.getStorageUsage(owner);
    const planId = subscription?.planId || "basic";
    const plan = PRICING_PLANS[planId as keyof typeof PRICING_PLANS];

    let allowed = true;
    let message = "";

    switch (operation) {
      case "upload_file":
        if (usage.totalUsed + size > plan.storage.totalSpace) {
          allowed = false;
          message = `存储空间不足。当前：${formatSize(usage.totalUsed)}/${formatSize(plan.storage.totalSpace)}。升级套餐可扩展至 5 GB 或 50 GB。`;
        } else if (size > plan.storage.maxFileSize) {
          allowed = false;
          message = `文件过大。最大允许：${formatSize(plan.storage.maxFileSize)}。`;
        }
        break;
      case "create_module":
        if (usage.breakdown.modules.count >= plan.storage.maxModules) {
          allowed = false;
          message = `模块数量已达上限：${plan.storage.maxModules}。`;
        }
        break;
    }

    return {
      allowed,
      remaining: plan.storage.totalSpace - usage.totalUsed,
      message: allowed ? undefined : message,
    };
  });

  // 升级套餐
  app.post("/api/v1/lighttick/billing/upgrade", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { planId, paymentMethod, interval } = req.body as {
      planId: string;
      paymentMethod?: { type: string; last4?: string };
      interval?: "monthly" | "yearly";
    };

    if (!Object.keys(PRICING_PLANS).includes(planId)) {
      return reply.status(400).send({ error: "Invalid plan ID" });
    }

    // TODO: 集成支付网关（支付宝/微信/Stripe）
    // 这里只是模拟订阅成功
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await repo.saveUserSubscription({
      userId: owner.userId,
      planId: planId as any,
      status: "active",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
      paymentMethod: paymentMethod
        ? {
            type: paymentMethod.type as any,
            last4: paymentMethod.last4,
          }
        : undefined,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    return {
      status: "active",
      plan: PRICING_PLANS[planId as keyof typeof PRICING_PLANS],
    };
  });

  // 取消订阅
  app.post("/api/v1/lighttick/billing/cancel", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const subscription = await repo.getUserSubscription(owner);
    if (!subscription || subscription.status !== "active") {
      return reply.status(400).send({ error: "No active subscription" });
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.updatedAt = new Date().toISOString();
    await repo.saveUserSubscription(subscription);

    return {
      status: "cancelled",
      cancelAtPeriodEnd: true,
      accessUntil: subscription.currentPeriodEnd,
      message: "订阅将在当前周期结束后取消。",
    };
  });

  // 获取存储使用详情
  app.get("/api/v1/lighttick/billing/storage-usage", async (req, reply) => {
    const owner = (req as any).owner as LightTickOwner;
    if (!owner) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const usage = await repo.getStorageUsage(owner);
    return usage;
  });
};

// 辅助函数：格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
