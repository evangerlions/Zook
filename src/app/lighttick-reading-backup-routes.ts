import { ReadingBackupService } from "../modules/lighttick/independent-reading/reading-backup.service.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
export async function handleReadingBackupRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
  part: string,
) {
  const s = new ReadingBackupService(repo, authorize),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (part === "/backups") {
    if (r.method === "GET") return s.list(owner);
    if (r.method === "POST") return s.create(owner, r.body, key);
  }
  const receipt = /^\/backup-receipts\/([a-zA-Z0-9_-]+)$/.exec(part);
  if (receipt && r.method === "GET") return s.receipt(owner, receipt[1]);
  const match =
    /^\/backups\/(readbackup-[a-f0-9]{40})(?:\/(delete|parts\/(\d+)))?$/.exec(
      part,
    );
  if (match) {
    if (r.method === "GET" && !match[2]) return s.read(owner, match[1]);
    if (r.method === "GET" && match[3] !== undefined)
      return s.part(owner, match[1], Number(match[3]));
    if (r.method === "POST" && match[2] === "delete")
      return s.delete(owner, match[1], r.body, key);
  }
  fail(405, "请核对阅读备份的具体入口与操作方法。");
}
