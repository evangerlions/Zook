import type { BodyLogStores } from "../../infrastructure/bodylog-store-ports.ts";
import type { BodyLogBuddyService } from "../bodylog/bodylog-buddy.service.ts";
import type { BodyLogGroupService } from "../bodylog/bodylog-group.service.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";

const DAY_MS = 86_400_000;

/**
 * BodyLogWorkerService handles scheduled tasks for buddy and group settlements.
 */
export class BodyLogWorkerService {
  constructor(
    private readonly jobs: BodyLogStores['jobs'],
    private readonly buddyService: BodyLogBuddyService,
    private readonly groupService: BodyLogGroupService,
    private readonly logger: StructuredLogger,
  ) {}

  /**
   * Process batch of scheduled settlements.
   * Returns statistics about processed settlements.
   */
  async processBatch(): Promise<{
    dailyBuddySettlement: boolean;
    dailyGroupSettlement: boolean;
    weeklyGroupSettlement: boolean;
  }> {
    const now = new Date();
    const today = now.toISOString().split("T")[0] as string;

    let weeklyGroupSettlement = false;

    // Settle the completed UTC day on the first available tick.
    const dailyBuddySettlement = await this.runOnce(`daily-buddy:${today}`, "daily buddy settlement", () => this.buddyService.dailySettlement());
    const dailyGroupSettlement = await this.runOnce(`daily-group:${today}`, "daily group settlement", () => this.groupService.dailySettlement());

    // On Monday, report the previous seven completed UTC days.
    const isEndOfWeek = now.getUTCDay() === 1;

    if (isEndOfWeek) {
      const weekStart = new Date(now.getTime() - 7 * DAY_MS).toISOString().split("T")[0];
      weeklyGroupSettlement = await this.runOnce(`weekly-group:${weekStart}`, "weekly group settlement", () => this.groupService.weeklySettlement());
    }

    return {
      dailyBuddySettlement,
      dailyGroupSettlement,
      weeklyGroupSettlement,
    };
  }

  private async runOnce(key: string, label: string, job: () => Promise<void>): Promise<boolean> {
    try {
      const completed = await this.jobs.runOnce(key, job);
      if (completed) this.logger.info(`${label} completed`);
      return completed;
    } catch (error) {
      this.logger.error(`${label} failed`, { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}
