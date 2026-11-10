import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ReadingService } from "../modules/lighttick/reading/reading.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleReadingRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/reading";
  if (r.path !== root && !r.path.startsWith(root + "/")) return;
  const service = new ReadingService(repo, authorize),
    part = r.path.slice(root.length);
  if (r.method === "GET" && part === "/library")
    return service.list(owner, r.query);
  if (r.method === "GET" && part === "/export") return service.export(owner);
  const receipt = /^\/receipts\/([a-zA-Z0-9_-]+)$/.exec(part);
  if (r.method === "GET" && receipt) return service.receipt(owner, receipt[1]);
  const match =
    /^\/articles\/(article-[a-zA-Z0-9_-]+)(?:\/(history|personal|position|archive|restore))?$/.exec(
      part,
    );
  if (match) {
    const [, id, action] = match;
    if (r.method === "GET" && !action) return service.read(owner, id);
    if (r.method === "GET" && action === "history")
      return service.history(
        owner,
        id,
        r.query?.cursor === undefined ? 2147483648 : Number(r.query.cursor),
      );
    const key =
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    if (r.method === "PUT" && !action)
      return service.write(owner, id, "import", object(r.body), key);
    if (r.method === "POST" && action && action !== "history")
      return service.write(owner, id, action, object(r.body), key);
    fail(405, "请核对阅读操作的方法。");
  }
  fail(404, "未找到此阅读入口。");
}
