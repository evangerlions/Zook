import { ResearchService } from "../modules/lighttick/investments/research/research.service.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import {
  object,
  integer,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleResearchRequest(
  repo: LightTickRepository,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/investments/research";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  const s = new ResearchService(repo, authorize),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  const limit = (fallback: number) =>
    r.query?.limit === undefined
      ? fallback
      : integer(Number(r.query.limit), 1, path.endsWith("/history") ? 20 : 100);
  if (!path && r.method === "GET") {
    if (
      r.query?.include_archived !== undefined &&
      !["true", "false"].includes(r.query.include_archived)
    )
      fail(422, "include_archived must be true or false.");
    return s.listEntries(
      o,
      r.query?.instrument_id,
      r.query?.cursor ?? "",
      limit(20),
      r.query?.include_archived === "true",
    );
  }
  const m = /^\/(inv-[a-zA-Z0-9_-]+)(?:\/(history|archive|restore))?$/.exec(
    path,
  );
  if (!m) fail(404, "Research route was not found.");
  if (r.method === "GET" && !m[2]) return s.readEntry(o, m[1]);
  if (r.method === "GET" && m[2] === "history")
    return s.history(o, m[1], r.query?.cursor ?? "", limit(10));
  if (r.method === "PUT" && !m[2]) return s.write(o, m[1], object(r.body), key);
  if (r.method === "POST" && ["archive", "restore"].includes(m[2]))
    return s.archive(o, m[1], object(r.body), key, m[2] === "archive");
  fail(404, "Research route was not found.");
}
