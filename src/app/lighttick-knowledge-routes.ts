import { exportReview } from "../modules/lighttick/knowledge/review.export.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { KnowledgeService } from "../modules/lighttick/knowledge/knowledge.service.ts";
import { ReviewService } from "../modules/lighttick/knowledge/review.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleKnowledgeRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/";
  if (
    !r.path.startsWith(root + "knowledge/") &&
    !r.path.startsWith(root + "review")
  )
    return;
  if (r.path === root + "review/export" && r.method === "GET")
    return exportReview(repo, owner, authorize);
  if (r.path === root + "review/source" && r.method === "GET")
    return new ReviewService(repo, authorize).source(owner, r.query ?? {});
  if (r.path === root + "review") {
    if (r.method !== "GET") fail(405, "Use GET for review.");
    return new ReviewService(repo, authorize).snapshot(owner, r.query);
  }
  const match =
    /^knowledge\/(knowledge-[a-zA-Z0-9-]+)(?:\/(archive|restore|history))?$/.exec(
      r.path.slice(root.length),
    );
  if (!match) fail(404, "Knowledge route was not found.");
  const s = new KnowledgeService(repo, authorize),
    id = match[1],
    action = match[2];
  if (r.method === "GET" && !action) return s.read(owner, id);
  if (r.method === "GET" && action === "history")
    return s.history(
      owner,
      id,
      r.query?.before === undefined ? 2147483647 : Number(r.query.before),
      r.query?.limit === undefined ? 20 : Number(r.query.limit),
    );
  if (
    (r.method === "PUT" && !action) ||
    (r.method === "POST" && ["archive", "restore"].includes(action))
  )
    return s.mutate(
      owner,
      id,
      (action as "archive" | "restore") ?? "save",
      object(r.body),
      r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "",
    );
  fail(405, "Unsupported knowledge method.");
}
