import { MaterialService } from "../modules/lighttick/investments/materials/material.service.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleMaterialRequest(
  repo: LightTickRepository,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/materials";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  const s = new MaterialService(repo, authorize),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  const limit = (n: number, max = 100) =>
    r.query?.limit === undefined ? n : integer(Number(r.query.limit), 1, max);
  if (!path && r.method === "GET") {
    if (
      r.query?.include_archived !== undefined &&
      !["true", "false"].includes(r.query.include_archived)
    )
      fail(422, "include_archived must be true or false.");
    return s.listMaterials(
      o,
      r.query?.cursor ?? "",
      limit(20),
      r.query?.include_archived === "true",
    );
  }
  const m =
    /^\/(inv-[a-zA-Z0-9_-]+)(?:\/(history|references|archive|restore|versions\/(\d+)))?$/.exec(
      path,
    );
  if (!m) fail(404, "Material route was not found.");
  if (r.method === "GET" && (!m[2] || m[3]))
    return s.readMaterial(o, m[1], m[3] ? Number(m[3]) : undefined);
  if (r.method === "GET" && m[2] === "history")
    return s.history(o, m[1], r.query?.cursor ?? "", limit(10, 20));
  if (r.method === "GET" && m[2] === "references")
    return s.references(o, m[1], r.query?.cursor ?? "", limit(20));
  if (r.method === "PUT" && !m[2]) return s.write(o, m[1], object(r.body), key);
  if (r.method === "POST" && ["archive", "restore"].includes(m[2]))
    return s.archive(o, m[1], object(r.body), key, m[2] === "archive");
  fail(404, "Material route was not found.");
}
