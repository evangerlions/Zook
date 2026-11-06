import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
/** The caller owns one transaction snapshot. Never return a partial export. */
export async function exportResearch(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const store = repo.investments.research,
    rows = await store.list(o),
    entries = [],
    versions = [],
    receipts = [];
  let count = 0,
    bytes = 0;
  if (rows.length > 500) fail(413, "Research export exceeds catalog capacity.");
  for (const row of rows) {
    const current = await store.get(o, row.id);
    if (!current) throw Error("Research disappeared inside snapshot");
    entries.push(current);
    const history = await store.versions(o, row.id, 101, 101);
    if (history.length !== current.revision)
      throw Error("Research version provenance missing");
    for (const e of history) {
      const op = await repo.getOperation(o, e.request_key);
      if (
        !op ||
        op.entityType !== "investment_research" ||
        op.entityId !== e.id
      )
        throw Error("Research receipt provenance missing");
      const receipt = {
        id: e.id,
        revision: e.revision,
        request_key: e.request_key,
        request_body: op.requestPayload,
      };
      count++;
      bytes += Buffer.byteLength(JSON.stringify([e, receipt]));
      if (count > 5000 || bytes > 8 * 1024 * 1024)
        fail(413, "Research export needs chunks; no partial export returned.");
      versions.push(e);
      receipts.push(receipt);
    }
  }
  const ai_artifacts = (await repo.researchAI.list(o))
    .filter((w) => w.adopted_at)
    .map((w) => ({
      id: w.id,
      revision: w.revision,
      kind: w.kind,
      input: w.input,
      output: w.output,
      adopted_at: w.adopted_at,
      request_key: w.request_key,
    }));
  const result = {
    entries,
    versions,
    receipts,
    ...(ai_artifacts.length ? { ai_artifacts } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024)
    fail(413, "Research export needs chunks; no partial export returned.");
  return result;
}
