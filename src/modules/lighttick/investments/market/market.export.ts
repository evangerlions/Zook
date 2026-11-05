import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
export async function exportMarket(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const rows = await repo.investments.market.summaries(o),
    works = await repo.investments.market.works(o),
    snapshots = [],
    receipts = [];
  let bytes = 0,
    count = rows.length + works.length;
  if (rows.length > 1000 || works.length > 1000)
    fail(413, "Market export exceeds capacity.");
  for (const r of rows) {
    const s = await repo.investments.market.snapshot(o, r.id);
    if (!s) throw Error("Market snapshot provenance missing");
    count += s.dataset.bars.length;
    if (count > 5000)
      fail(413, "Market export exceeds 5000 rows; chunks required.");
    bytes += Buffer.byteLength(JSON.stringify(s));
    if (bytes > 8 * 1024 * 1024)
      fail(413, "Market export needs chunks; no partial export returned.");
    snapshots.push(s);
  }
  for (const w of works) {
    const original = await repo.getOperation(o, w.request_key);
    if (
      !original ||
      original.entityType !== "investment_market" ||
      original.entityId !== w.instrument_id
    )
      throw Error("Market receipt provenance missing");
    const { fence, lease_until, appId, userId, ...safe } = w,
      r = { ...safe, request_body: original.requestPayload };
    bytes += Buffer.byteLength(JSON.stringify(r));
    if (bytes > 8 * 1024 * 1024)
      fail(413, "Market export needs chunks; no partial export returned.");
    receipts.push(r);
  }
  return { snapshots, receipts };
}
