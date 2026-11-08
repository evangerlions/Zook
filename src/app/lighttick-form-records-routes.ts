import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { FormRecordsService } from "../modules/lighttick/form-records/form-records.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleFormRecordsRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/form-records";
  if (r.path !== root && !r.path.startsWith(root + "/")) return;
  const service = new FormRecordsService(repo, authorize);
  if (r.method === "GET" && r.path === root) return service.read(owner);
  if (r.method === "GET" && r.path === root + "/export")
    return {
      format_version: 1,
      scope: "lighttick_partial_form_records",
      exported_at: new Date().toISOString(),
      snapshot: await service.read(owner),
    };
  const key =
    r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  const section = /^\/sections\/([a-z]+)$/.exec(r.path.slice(root.length));
  if (r.method === "PATCH" && section)
    return service.patch(owner, section[1], object(r.body), key);
  if (r.method === "PUT" && r.path === root)
    return service.save(owner, object(r.body), key);
  if (r.method === "POST" && r.path === root + "/clear")
    return service.clear(owner, object(r.body), key);
  fail(405, "不支持此局部表单操作。");
}
