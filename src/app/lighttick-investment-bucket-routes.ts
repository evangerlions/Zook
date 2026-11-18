import { InvestmentBucketService } from "../modules/lighttick/investments/buckets/bucket.service.ts";
import { BUCKET_LIMITS } from "../modules/lighttick/investments/buckets/bucket.validation.ts";
import { fail, integer, object } from "../modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";

export function handleInvestmentBucketRequest(repo: LightTickRepository, owner: LightTickOwner,
  request: HttpRequest, authorize: () => Promise<void>) {
  const match = /^\/api\/v1\/lighttick\/investments\/accounts\/(inv-[a-zA-Z0-9_-]+)\/buckets(?:\/versions\/(\d+))?$/.exec(request.path);
  if (!match) return;
  const [, id, revision] = match;
  const service = new InvestmentBucketService(repo, authorize);
  if (request.method === "GET") return revision
    ? service.version(owner, id, integer(Number(revision), 1, BUCKET_LIMITS.revisions)) : service.view(owner, id);
  if (request.method === "PUT" && !revision) {
    const body = object(request.body);
    if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024) fail(413, "Bucket command exceeds 64 KiB.");
    const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"] ?? "";
    return service.write(owner, id, body, key);
  }
  fail(404, "Bucket route was not found.");
}
