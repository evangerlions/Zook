import { AccountBackupService } from "./modules/lighttick/backup/account-backup.service.ts";
import type { LightTickRuntime } from "./modules/lighttick/lighttick-runtime.ts";
import type { StorageService } from "./infrastructure/files/storage.service.ts";
import type { PersistentFileStore } from "./infrastructure/files/persistent-file-store.ts";
export function attachLightTickBackups(
  runtime: LightTickRuntime | undefined,
  secrets: string[],
  storage: StorageService,
  files: PersistentFileStore,
) {
  if (runtime)
    runtime.backups = new AccountBackupService(runtime.repository, secrets, {
      read: (o, key) => storage.readOwnerText(files, o, key),
      restore: async (o, key, content) => {
        try {
          if ((await storage.readOwnerText(files, o, key)) === content)
            return key;
        } catch {}
        const r = await storage.storeOwnerText(
          files,
          o,
          "恢复的学习来源",
          content,
          "account-backup:" + key,
        );
        return r.storage_key;
      },
    });
}
