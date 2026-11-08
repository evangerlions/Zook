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
        if (
          await this.database.findFileByAppAndStorageKey(
            task.appId,
            task.storageKey,
          )
        ) {
          await this.database.deferFilePurge(task, this.clock());
          counts.retained++;
          continue;
        }
        if (!task.storageKey.startsWith(`files/${task.appId}/`))
          throw Error("FILE_PURGE_PATH_INVALID");
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
}
