import type { ApplicationDatabase } from "../database/application-database.ts";
import type { PersistentFileStore } from "./persistent-file-store.ts";
/** Existing worker tick; filesystem IO is outside product/owner transactions. */
export class FilePurgeService {
  constructor(
    readonly database: ApplicationDatabase,
    readonly store: PersistentFileStore,
    readonly clock = () => new Date(),
  ) {}
  async runBatch() {
    const tasks = await this.database.claimFilePurges(20, this.clock()),
      counts = { removed: 0, retry: 0, retained: 0 };
    for (const task of tasks) {
      try {
        // A shared/current metadata reference protects a path; this is never a generic orphan scanner.
        if (await this.hasCurrentReference(task.appId, task.storageKey)) {
          await this.database.deferFilePurge(task, this.clock());
          counts.retained++;
          continue;
        }
        await this.store.removeOwnedFile(task.storageKey);
        await this.database.completeFilePurge(task);
        counts.removed++;
      } catch {
        await this.database.deferFilePurge(task, this.clock());
        counts.retry++;
      }
    }
    return counts;
  }

  private async hasCurrentReference(appId: string, storageKey: string): Promise<boolean> {
    if (storageKey.startsWith(`files/${appId}/`)) {
      return Boolean(await this.database.findFileByAppAndStorageKey(appId, storageKey));
    }
    if (appId === "ai_novel" && /^feedback\/ai_novel\/\d{4}-\d{2}-\d{2}\/feedback_[a-z0-9]+\/fb_att_[a-z0-9]+\.(jpg|png|webp)$/.test(storageKey)) {
      return await this.database.getFeedbackConversationStore().hasAttachmentStoragePath(appId, storageKey);
    }
    throw Error("FILE_PURGE_PATH_INVALID");
  }
}
