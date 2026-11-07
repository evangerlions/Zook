import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
/** Caller holds the same owner snapshot as research/AI export. */
export async function exportMaterials(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const s = repo.investments.materials,
    rows = await s.list(o),
    entries = [],
    versions = [],
    receipts = [];
  let count = 0,
    bytes = 0;
  if (rows.length > 500) fail(413, "Material export exceeds catalog capacity.");
  for (const summary of rows) {
    const m = await s.get(o, summary.id);
    if (!m) throw Error("Material disappeared in snapshot");
    entries.push(m);
    const history = await s.versions(o, m.id, 101, 101);
    if (history.length !== m.revision)
      throw Error("Material version provenance missing");
    for (const v of history) {
      const op = await repo.getOperation(o, v.request_key);
      if (
        !op ||
        op.entityType !== "investment_material" ||
        op.entityId !== v.id
      )
        throw Error("Material receipt provenance missing");
      const receipt = {
        id: v.id,
        revision: v.revision,
        request_key: v.request_key,
        request_body: op.requestPayload,
      };
      count++;
      bytes += Buffer.byteLength(JSON.stringify([v, receipt]));
      if (count > 5000 || bytes > 8 * 1024 * 1024)
        fail(
          413,
          "Material export requires chunks; no partial export returned.",
        );
      versions.push(v);
      receipts.push(receipt);
    }
  }
  return { entries, versions, receipts };
}
