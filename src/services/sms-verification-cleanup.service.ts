import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { toDateKey } from "../shared/utils.ts";

const CLEANUP_SCOPE = "sms-verification-cleanup";
const LAST_RUN_KEY = "last-run-date";
const RETENTION_DAYS = 7;
const CLEANUP_HOUR = 4;

export interface SmsVerificationCleanupResult {
  ran: boolean;
  deletedCount: number;
  cutoffIso?: string;
  runDateKey?: string;
}

export class SmsVerificationCleanupService {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
  ) {}

  async runDailyCleanupIfDue(now = new Date()): Promise<SmsVerificationCleanupResult> {
    if (!this.shouldRunAt(now)) {
      return { ran: false, deletedCount: 0 };
    }

    const dateKey = toDateKey(now);
    const lastRunDate = await this.kvManager.getString(CLEANUP_SCOPE, LAST_RUN_KEY);
    if (lastRunDate === dateKey) {
      return { ran: false, deletedCount: 0, runDateKey: dateKey };
    }

    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deletedCount = await this.database.deleteSmsVerificationRecordsCreatedBefore(cutoff.toISOString());
    await this.kvManager.setString(CLEANUP_SCOPE, LAST_RUN_KEY, dateKey);
    return {
      ran: true,
      deletedCount,
      cutoffIso: cutoff.toISOString(),
      runDateKey: dateKey,
    };
  }

  shouldRunAt(now: Date): boolean {
    return now.getHours() >= CLEANUP_HOUR;
  }
}
