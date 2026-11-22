import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { ExperienceKind } from "../modules/lighttick/experience/experience.types.ts";
import { ExperienceService } from "../modules/lighttick/experience/experience.service.ts";
import type { HttpRequest } from "../shared/types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const kinds: Record<string, ExperienceKind> = {
  applications: "application",
  errors: "error",
  "error-types": "error_type",
};
export async function handleExperienceRequest(
  repo: LightTickRepository,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/experience",
    s = new ExperienceService(repo, authorize),
    suffix = r.path.slice(root.length),
    q = r.query ?? {};
  if (r.method === "GET") {
    if (suffix === "/setup") return s.setup(o);
    if (suffix === "/categories") return s.categories(o, q);
    if (suffix === "/concepts") return s.concepts(o, q);
    if (suffix === "/repeated") return s.repeated(o, q);
    if (suffix === "/export") return s.export(o, q);
    const receipt = /^\/receipts\/([a-zA-Z0-9_-]{8,128})$/.exec(suffix);
    if (receipt) return s.receipt(o, receipt[1]);
  }
  const route =
    /^\/(applications|errors|error-types)(?:\/([a-zA-Z0-9_-]+))?(?:\/(history|archive|restore|deletion-preview|delete))?$/.exec(
      suffix,
    );
  if (!route) fail(404, "经验记录入口不存在。");
  const kind = kinds[route[1]],
    id = route[2],
    action = route[3];
  if (r.method === "GET") {
    if (id === "stats" && !action && kind !== "error_type")
      return s.stats(o, kind, q);
    if (!id) return s.list(o, kind, q);
    if (!action) return s.read(o, kind, id);
    if (action === "history") {
      if (Object.keys(q).some((k) => k !== "before"))
        fail(422, "历史分页参数无效。");
      return s.history(
        o,
        kind,
        id,
        q.before === undefined ? 2147483648 : Number(q.before),
      );
    }
    if (action === "deletion-preview") return s.deletionPreview(o, kind, id);
  }
  const key = r.headers["idempotency-key"] ?? "";
  if (id && r.method === "PUT" && !action)
    return s.write(o, kind, id, "save", r.body, key);
  if (
    id &&
    r.method === "POST" &&
    ["archive", "restore", "delete"].includes(action)
  )
    return s.write(
      o,
      kind,
      id,
      action as "archive" | "restore" | "delete",
      r.body,
      key,
    );
  fail(404, "经验记录操作不存在。");
}
