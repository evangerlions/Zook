import type { LightTickRepository } from "../lighttick.repository.ts";
/** Reuse the existing worker recovery tick; take the owner lock before cascades/deletion. */
export async function pruneExpiredReadingBackups(
  repo: LightTickRepository,
  now: string,
) {
  const owners = await repo.readingBackups.expiredOwners(now, 20);
  let failed = 0;
  for (const owner of owners)
    try {
      await repo.transaction(owner, () =>
        repo.readingBackups.prune(owner, now),
      );
    } catch {
      failed++;
    }
  return { checked: owners.length, failed };
}
