import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";

/**
 * 行为应用追踪 — 记录用户将知识应用于实际场景的行为。
 */

export type BehaviorModule =
  | "fupan"      // 复盘
  | "zhenghe"    // 整合
  | "renzhi"     // 认知
  | "xiezuo"     // 写作
  | "biaoda"     // 表达
  | "yingyu"     // 英语
  | "siwei"      // 思维
  | "gaorenzhi"; // 高认知

export const VALID_MODULES: BehaviorModule[] = [
  "fupan", "zhenghe", "renzhi", "xiezuo",
  "biaoda", "yingyu", "siwei", "gaorenzhi",
];

export interface BehaviorApplication {
  id: string;
  date: string;           // YYYY-MM-DD
  module_id: BehaviorModule;
  concept: string;        // 应用的概念
  scenario: string;       // 应用场景
  effectiveness: number;  // 0-5 有效性评分
  created_at: string;
}

export interface BehaviorApplicationRow extends LightTickOwner {
  id: string;
  payload: BehaviorApplication;
}

export interface BehaviorStats {
  total: number;
  period_days: number;
  start: string;
  end: string;
  by_module: Record<string, number>;
  top_concepts: { concept: string; count: number }[];
  trend: { date: string; count: number }[];
}

export class LightTickBehaviorService {
  constructor(private readonly repository: LightTickRepository) {}

  async create(owner: LightTickOwner, input: {
    date: string;
    module_id: BehaviorModule;
    concept: string;
    scenario?: string;
    effectiveness?: number;
  }): Promise<BehaviorApplication> {
    // Validate
    if (!VALID_MODULES.includes(input.module_id)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "module_id is invalid.");
    }
    if (!input.concept || input.concept.trim().length === 0) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "concept is required.");
    }
    if (input.concept.length > 100) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "concept must be ≤100 chars.");
    }
    if ((input.scenario ?? "").length > 500) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "scenario must be ≤500 chars.");
    }
    const effectiveness = input.effectiveness ?? 0;
    if (effectiveness < 0 || effectiveness > 5) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "effectiveness must be 0-5.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "date must be YYYY-MM-DD.");
    }

    const app: BehaviorApplication = {
      id: `behavior-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      date: input.date,
      module_id: input.module_id,
      concept: input.concept.trim(),
      scenario: (input.scenario ?? "").trim(),
      effectiveness,
      created_at: new Date().toISOString(),
    };

    await this.repository.saveBehaviorApplication(owner, app);
    return app;
  }

  async list(owner: LightTickOwner, query: {
    date_from?: string;
    date_to?: string;
    module_id?: BehaviorModule;
  }): Promise<BehaviorApplication[]> {
    return await this.repository.listBehaviorApplications(owner, query);
  }

  async get(owner: LightTickOwner, id: string): Promise<BehaviorApplication> {
    const app = await this.repository.getBehaviorApplication(owner, id);
    if (!app) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Behavior application not found.");
    }
    return app;
  }

  async update(owner: LightTickOwner, id: string, input: Partial<{
    date: string;
    module_id: BehaviorModule;
    concept: string;
    scenario: string;
    effectiveness: number;
  }>): Promise<BehaviorApplication> {
    const existing = await this.get(owner, id);

    if (input.module_id !== undefined && !VALID_MODULES.includes(input.module_id)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "module_id is invalid.");
    }
    if (input.concept !== undefined) {
      if (input.concept.trim().length === 0) {
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "concept is required.");
      }
      if (input.concept.length > 100) {
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "concept must be ≤100 chars.");
      }
    }
    if (input.scenario !== undefined && input.scenario.length > 500) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "scenario must be ≤500 chars.");
    }
    if (input.effectiveness !== undefined && (input.effectiveness < 0 || input.effectiveness > 5)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "effectiveness must be 0-5.");
    }
    if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "date must be YYYY-MM-DD.");
    }

    const updated: BehaviorApplication = {
      ...existing,
      date: input.date ?? existing.date,
      module_id: input.module_id ?? existing.module_id,
      concept: input.concept !== undefined ? input.concept.trim() : existing.concept,
      scenario: input.scenario !== undefined ? input.scenario.trim() : existing.scenario,
      effectiveness: input.effectiveness !== undefined ? input.effectiveness : existing.effectiveness,
    };

    await this.repository.updateBehaviorApplication(owner, updated);
    return updated;
  }

  async delete(owner: LightTickOwner, id: string): Promise<void> {
    const deleted = await this.repository.deleteBehaviorApplication(owner, id);
    if (!deleted) {
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Behavior application not found.");
    }
  }

  async getStats(owner: LightTickOwner, periodDays: number = 30): Promise<BehaviorStats> {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - periodDays + 1);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = today.toISOString().slice(0, 10);

    const apps = await this.repository.listBehaviorApplications(owner, {
      date_from: startStr,
      date_to: endStr,
    });

    // by_module
    const byModule: Record<string, number> = {};
    for (const app of apps) {
      byModule[app.module_id] = (byModule[app.module_id] ?? 0) + 1;
    }

    // top_concepts
    const conceptCounts: Record<string, number> = {};
    for (const app of apps) {
      conceptCounts[app.concept] = (conceptCounts[app.concept] ?? 0) + 1;
    }
    const topConcepts = Object.entries(conceptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([concept, count]) => ({ concept, count }));

    // trend (daily)
    const dailyCounts: Record<string, number> = {};
    for (const app of apps) {
      dailyCounts[app.date] = (dailyCounts[app.date] ?? 0) + 1;
    }
    const trend: { date: string; count: number }[] = [];
    for (let i = 0; i < periodDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      trend.push({ date: dateStr, count: dailyCounts[dateStr] ?? 0 });
    }

    return {
      total: apps.length,
      period_days: periodDays,
      start: startStr,
      end: endStr,
      by_module: byModule,
      top_concepts: topConcepts,
      trend,
    };
  }

  async getDistinctConcepts(owner: LightTickOwner): Promise<string[]> {
    return await this.repository.listDistinctBehaviorConcepts(owner);
  }
}
