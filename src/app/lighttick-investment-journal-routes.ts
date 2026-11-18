import { InvestmentJournalService } from "../modules/lighttick/investments/journal/journal.service.ts";
import { evidenceReference } from "../modules/lighttick/investments/journal/journal.validation.ts";
import { investmentId } from "../modules/lighttick/investments/investment.service.ts";
import { fail, integer, object } from "../modules/lighttick/learning/native-learning.validation.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";

export async function handleInvestmentJournalRequest(
  repo: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  const root = "/api/v1/lighttick/investments/journal";
  if (request.path !== root && !request.path.startsWith(root + "/")) return;
  const service = new InvestmentJournalService(repo, authorize);
  const [domain, id, segment, subId, extra] = request.path.slice(root.length + 1).split("/");
  const q = request.query ?? {};
  if (request.method === "GET") {
    if (request.path === root) return service.dashboard(owner);
    if (domain === "instruments" && segment === "timeline" && subId === undefined)
      return service.timeline(owner, id, q.kind ?? "all", q.cursor ?? "", q.limit === undefined ? 20 : integer(Number(q.limit), 1, 100));
    if (domain === "decisions" && id && segment === undefined)
      return service.decision(owner, investmentId(id), q.revision === undefined ? undefined : integer(Number(q.revision), 1, 100));
    if (domain === "evidence" && subId && extra === undefined)
      return service.readEvidence(owner, evidenceReference({ kind: id, id: segment, revision: Number(subId) }));
    if (domain === "receipts" && id && segment === undefined) {
      let originalKey: string;
      try { originalKey = decodeURIComponent(id); }
      catch { fail(422, "Invalid receipt identity."); }
      return service.receipt(owner, originalKey);
    }
    fail(404, "Journal route was not found.");
  }
  const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"] ?? "";
  const body = object(request.body);
  if (Buffer.byteLength(JSON.stringify(body)) > 32 * 1024) fail(413, "Journal command exceeds 32 KiB.");
  if (request.method === "PUT" && id && segment === undefined) {
    if (domain === "watchlist") return service.follow(owner, investmentId(id), body, key);
    if (domain === "decisions") return service.saveDecision(owner, investmentId(id), body, key);
  }
  if (request.method === "PUT" && domain === "decisions" && segment === "reviews" && subId && extra === undefined)
    return service.review(owner, investmentId(id), investmentId(subId), body, key);
  fail(404, "Journal route was not found.");
}
