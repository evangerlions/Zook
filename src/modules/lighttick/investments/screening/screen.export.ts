import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { fail } from "../../learning/native-learning.validation.ts";
/** Caller owns a consistent owner snapshot. Include complete originals, not leases or credentials. */
export async function exportScreening(
  repo: LightTickRepository,
  o: LightTickOwner,
) {
  const s = repo.investments.screening,
    definitions = [],
    versions = [],
    receipts = [],
    runs = [];
  let bytes = 0,
    count = 0;
  const bound = (v: unknown) => {
    count++;
    bytes += Buffer.byteLength(JSON.stringify(v));
    if (count > 5000 || bytes > 8 * 1024 * 1024)
      fail(
        413,
        "Screening export requires chunks; no partial export returned.",
      );
  };
  for (const kind of ["rules", "templates"] as const) {
    const rows = await s.definitions(o, kind);
    if (rows.length > 200) fail(413, "Definition export exceeds capacity.");
    for (const d of rows) {
      definitions.push(d);
      const history = await s.versions(o, kind, d.id, 101, 101);
      if (history.length !== d.revision)
        throw Error("Screen definition history provenance missing");
      for (const v of history) {
        const op = await repo.getOperation(o, v.request_key);
        if (
          !op ||
          op.entityType !== "investment_screen_" + kind ||
          op.entityId !== v.id
        )
          throw Error("Screen definition original receipt missing");
        const receipt = {
          kind,
          id: v.id,
          revision: v.revision,
          request_key: v.request_key,
          request_body: op.requestPayload,
        };
        bound([v, receipt]);
        versions.push(v);
        receipts.push(receipt);
      }
    }
  }
  const works = await s.works(o);
  if (works.length > 100) fail(413, "Run export exceeds capacity.");
  for (const summary of works) {
    const w = await s.work(o, summary.id);
    if (!w) throw Error("Screen work disappeared inside snapshot");
    const commands = [];
    for (const key of w.command_keys) {
      const op = await repo.getOperation(o, key);
      if (
        !op ||
        op.entityType !== "investment_screen_run" ||
        op.entityId !== w.id
      )
        throw Error("Screen work original receipt missing");
      commands.push({
        key,
        action: op.action,
        body: op.requestPayload,
        result: op.resultPayload,
      });
    }
    const { appId, userId, fence, lease_until, command_keys, ...run } = w;
    const row = { ...run, commands };
    bound(row);
    runs.push(row);
  }
  return { definitions, versions, receipts, runs };
}
